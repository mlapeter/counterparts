/**
 * Schema v7 (2026-09-25, docs/time.md): moments on every table that holds
 * records, the model that wrote a memory's words, and a reminder date that is
 * a calendar date as said — plus the migration from a REAL v6 file, the first
 * one since the copy-before-migrating seam (#214) shipped.
 *
 * Hermetic: a fresh temp data dir per test, removed after. Zones are pinned by
 * name, so the suite reads the same in any `TZ`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCHEMA_VERSION, Store, isStoreError, paths } from "../src/core/store/index.js";
import type { StoreOptions } from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";

let dir: string;
const open: Store[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-v7-"));
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}, at = dir): Store {
  const s = Store.open({ dir: at, ...opts });
  open.push(s);
  return s;
}

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return isStoreError(err) ? err.code : String(err);
  }
}

/** A clock the test turns by hand. */
function clock(iso: string): { now: () => number; set(iso: string): void } {
  let at = Date.parse(iso);
  return {
    now: () => at,
    set(next: string): void {
      at = Date.parse(next);
    },
  };
}

const V7_DROPPED: readonly [string, string][] = [
  ["memories", "created_at"],
  ["memories", "updated_at"],
  ["memories", "model"],
  ["memories", "event_date"],
  ["versions", "created_at"],
  ["versions", "model"],
  ["versions", "event_date"],
  ["edges", "created_at"],
  ["edges", "updated_at"],
  ["prospective", "created_at"],
  ["prospective", "updated_at"],
];

/**
 * A REAL v6 file: a store this build made, with every v7 column and index
 * taken off again and the stamp put back to 6 — the shape the 0.3.1 build
 * writes. (The migration check against an actual 0.3.1 checkout is in the PR.)
 */
function makeV6(at: string): { mem: string; ver: string } {
  const s = Store.open({ dir: at });
  const mem = s.put({ type: "memory", kind: "fact", body: "written by the v6 build", learnedOn: "2026-09-24" });
  const ver = s.put({ type: "memory", kind: "fact", body: "the first wording" });
  s.revise(ver, { body: "the second wording" });
  s.link({ src: mem, dst: ver, weight: 0.5, day: 0 });
  s.close();
  const db = new Database(paths.operational(at));
  db.run("DROP INDEX IF EXISTS memories_event_date");
  db.run("DROP TABLE feelings");
  for (const [table, column] of V7_DROPPED) db.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '6')");
  db.close();
  return { mem, ver };
}

function schemaOf(path: string): string[] {
  const d = new Database(path, { readonly: true });
  const out: string[] = [];
  for (const table of ["memories", "versions", "edges", "prospective", "feelings"]) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    for (const c of cols) out.push(`${table}.${c.name} ${c.type} ${c.notnull} ${String(c.dflt_value)}`);
    const idx = d.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[];
    for (const i of idx) out.push(`${table} index ${i.name}`);
  }
  d.close();
  return out.sort();
}

describe("the v6 → v7 migration", () => {
  test("a real v6 file: copied first, migrated in place, rows intact, schema identical to a fresh v7", () => {
    const { mem, ver } = makeV6(dir);
    const snaps = join(dir, "..", `${dir.split("/").pop() ?? "x"}-snaps`);
    // An instrument meets a v6 store as not-yet-migrated: v7 is its read floor.
    expect(code(() => store({ observer: true }))).toBe("STORE_UNINITIALIZED");
    open.splice(0);

    const s = store({ snapshotsDir: snaps });
    expect(s.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(SCHEMA_VERSION).toBe(7);
    expect(s.migration?.from).toBe("6");
    expect(s.migration?.to).toBe(7);
    // ONE copy, taken before the change.
    expect(existsSync(snaps)).toBe(true);
    expect(readdirSync(snaps).length).toBe(1);

    // Old rows keep their words and their dates; their moments are NULL, not invented.
    expect(s.readProse(mem).body).toBe("written by the v6 build");
    expect(s.readProse(mem).learnedOn).toBe("2026-09-24");
    expect(s.read(mem).createdAt).toBeNull();
    expect(s.read(mem).model).toBeNull();
    expect(s.versions(ver)[0]?.created_at).toBeNull();
    expect(s.edgesFrom(mem)[0]?.created_at).toBeNull();
    // The migration's own row names the copy.
    expect(s.eventLog({ name: "store.migrated" }).length).toBe(1);
    s.close();
    open.splice(0);

    const fresh = join(dir, "fresh");
    Store.open({ dir: fresh }).close();
    expect(schemaOf(paths.operational(dir))).toEqual(schemaOf(paths.operational(fresh)));
    rmSync(snaps, { recursive: true, force: true });
  });
});

describe("the migration moves lastActiveDate onto the local calendar (review S1)", () => {
  test("an MDT evening's UTC-tomorrow is clamped to the person's today; an earlier date is left alone", () => {
    makeV6(dir);
    const db = new Database(paths.operational(dir));
    db.run("UPDATE meta SET value = '2026-09-26' WHERE key = 'lastActiveDate'");
    db.close();
    const snaps = join(dir, "..", `${dir.split("/").pop() ?? "x"}-snaps`);
    // 20:00 MDT on the 25th — UTC is already the 26th.
    const s = store({ snapshotsDir: snaps, now: () => Date.parse("2026-09-26T02:00:00Z"), timeZone: "America/Denver" });
    expect(s.getMeta("lastActiveDate")).toBe("2026-09-25");
    expect(s.advanceClock("2026-09-25")).toBe(s.livedDay());
    rmSync(snaps, { recursive: true, force: true });
  });

  test("a lastActiveDate already at or before today is untouched", () => {
    makeV6(dir);
    const db = new Database(paths.operational(dir));
    db.run("UPDATE meta SET value = '2026-09-20' WHERE key = 'lastActiveDate'");
    db.close();
    const snaps = join(dir, "..", `${dir.split("/").pop() ?? "x"}-snaps2`);
    const s = store({ snapshotsDir: snaps, now: () => Date.parse("2026-09-26T02:00:00Z"), timeZone: "America/Denver" });
    expect(s.getMeta("lastActiveDate")).toBe("2026-09-20");
    rmSync(snaps, { recursive: true, force: true });
  });
});

describe("moments (created_at / updated_at)", () => {
  test("a put stamps both from the store's clock; a revise moves updated_at and archives the words' own moment", () => {
    const c = clock("2026-09-25T15:00:00Z");
    const s = store({ now: c.now, timeZone: "America/Denver" });
    const id = s.put({ type: "memory", kind: "fact", body: "first", model: "claude-opus-5-5" });
    const born = Date.parse("2026-09-25T15:00:00Z");
    expect(s.read(id).createdAt).toBe(born);
    expect(s.read(id).updatedAt).toBe(born);

    c.set("2026-09-25T16:00:00Z");
    s.revise(id, { body: "second" });
    expect(s.read(id).createdAt).toBe(born);
    expect(s.read(id).updatedAt).toBe(Date.parse("2026-09-25T16:00:00Z"));
    const v = s.versions(id)[0];
    // The archived words were written at `born`; they stopped being current at 16:00.
    expect(v?.created_at).toBe(born);
    expect(v?.archived_at).toBe(Date.parse("2026-09-25T16:00:00Z"));
    expect(v?.model).toBe("claude-opus-5-5");
  });

  test("archive and supersede are changes of state, and move updated_at", () => {
    const c = clock("2026-09-25T15:00:00Z");
    const s = store({ now: c.now });
    const a = s.put({ type: "memory", kind: "fact", body: "a" });
    const b = s.put({ type: "memory", kind: "fact", body: "b" });
    c.set("2026-09-25T17:00:00Z");
    s.archive(a, "test");
    s.supersede(b, { type: "memory", kind: "fact", body: "b, again" });
    expect(s.read(a).updatedAt).toBe(Date.parse("2026-09-25T17:00:00Z"));
    expect(s.read(b).updatedAt).toBe(Date.parse("2026-09-25T17:00:00Z"));
  });

  test("physics bookkeeping does NOT move updated_at", () => {
    const c = clock("2026-09-25T15:00:00Z");
    const s = store({ now: c.now });
    const id = s.put({ type: "memory", kind: "fact", body: "x" });
    c.set("2026-09-26T15:00:00Z");
    s.updatePhysics(id, { pressure: 0.5 });
    s.setBand(id, "semantic", 1);
    expect(s.read(id).updatedAt).toBe(Date.parse("2026-09-25T15:00:00Z"));
  });

  test("re-linking and re-arming keep created_at and move updated_at (an upsert, not a replace)", () => {
    const c = clock("2026-09-25T15:00:00Z");
    const s = store({ now: c.now });
    const a = s.put({ type: "memory", kind: "fact", body: "a" });
    const b = s.put({ type: "memory", kind: "fact", body: "b" });
    s.link({ src: a, dst: b, weight: 0.2, day: 0 });
    s.setProspective({ memoryId: a, windowKey: "d:2026-10-15", eventDate: "2026-10-15", precision: "day", state: "armed" });
    c.set("2026-09-26T15:00:00Z");
    s.linkMany([{ src: a, dst: b, weight: 0.4, day: 1 }]);
    s.setProspective({ memoryId: a, windowKey: "d:2026-10-15", eventDate: "2026-10-15", precision: "day", state: "fired", fires: 1 });
    const edge = s.edgesFrom(a)[0];
    const window = s.prospectiveFor(a)[0];
    expect([edge?.created_at, edge?.updated_at, edge?.weight]).toEqual([
      Date.parse("2026-09-25T15:00:00Z"),
      Date.parse("2026-09-26T15:00:00Z"),
      0.4,
    ]);
    expect([window?.created_at, window?.updated_at, window?.state]).toEqual([
      Date.parse("2026-09-25T15:00:00Z"),
      Date.parse("2026-09-26T15:00:00Z"),
      "fired",
    ]);
  });
});

describe("learned_on is the LOCAL date of the moment it was written", () => {
  test("across midnight: 11:50 pm in Denver is the 25th, though UTC is already the 26th", () => {
    const s = store({ now: () => Date.parse("2026-09-26T05:50:00Z"), timeZone: "America/Denver" });
    const id = s.put({ type: "memory", kind: "fact", body: "late" });
    expect(s.readProse(id).learnedOn).toBe("2026-09-25");
    expect(s.today()).toBe("2026-09-25");
    expect(s.zone()).toBe("America/Denver");
  });

  test("a server on UTC: the configured zone decides, not the machine's", () => {
    const s = store({ now: () => Date.parse("2026-09-26T05:50:00Z"), timeZone: "UTC" });
    expect(s.readProse(s.put({ type: "memory", kind: "fact", body: "late" })).learnedOn).toBe("2026-09-26");
  });

  test("an explicit learnedOn still wins (mint dates a deposit by its own instant)", () => {
    const s = store({ timeZone: "UTC" });
    expect(s.readProse(s.put({ type: "memory", kind: "fact", body: "x", learnedOn: "2026-01-02" })).learnedOn).toBe(
      "2026-01-02",
    );
  });
});

describe("model — who wrote the words", () => {
  test("a host-reported model id is stored; anything else is NULL, never a guess", () => {
    const s = store();
    const named = s.put({ type: "memory", kind: "fact", body: "a", model: "claude-opus-5-5[1m]" });
    const bad = s.put({ type: "memory", kind: "fact", body: "b", model: "<synthetic>" });
    const none = s.put({ type: "memory", kind: "fact", body: "c" });
    expect([s.read(named).model, s.read(bad).model, s.read(none).model]).toEqual(["claude-opus-5-5[1m]", null, null]);
  });

  test("new words with no model named are no longer the last model's; a meta-only revise keeps it", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "a", model: "claude-opus-5-5" });
    s.revise(id, { meta: { flagged: true } });
    expect(s.read(id).model).toBe("claude-opus-5-5");
    s.revise(id, { body: "rewritten by the owner" });
    expect(s.read(id).model).toBeNull();
    s.revise(id, { body: "rewritten by a session", model: "claude-sonnet-5" });
    expect(s.read(id).model).toBe("claude-sonnet-5");
    // Each version keeps the model that wrote IT.
    expect(s.versions(id).map((v) => v.model)).toEqual(["claude-opus-5-5", "claude-opus-5-5", null]);
  });
});

describe("event_date — a reminder's date, as said", () => {
  test("day, month, year and range are stored as written and read back on the document", () => {
    const s = store();
    for (const date of ["2026-10-15", "2026-10", "2027", "2026-10-20..2026-10-31"]) {
      const id = s.put({ type: "memory", kind: "fact", body: `due ${date}`, eventDate: date });
      expect(s.readProse(id).eventDate).toBe(date);
    }
  });

  test("a date is stored trimmed, and year 0000 is not a date (review N5)", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "x", eventDate: " 2026-10-15 " });
    expect(s.row(id)?.event_date).toBe("2026-10-15");
    expect(code(() => s.put({ type: "memory", kind: "fact", body: "y", eventDate: "0000" }))).toBe("EVENT_DATE_INVALID");
  });

  test("a date nothing can read is refused by name, and nothing is written", () => {
    const s = store();
    for (const bad of ["Oct 15", "2026-02-30", "2026-10-31..2026-10-01"]) {
      expect(code(() => s.put({ type: "memory", kind: "fact", body: "x", eventDate: bad }))).toBe("EVENT_DATE_INVALID");
    }
    expect(s.list()).toEqual([]);
    const id = s.put({ type: "memory", kind: "fact", body: "x" });
    expect(code(() => s.revise(id, { eventDate: "soon" }))).toBe("EVENT_DATE_INVALID");
    expect(s.versions(id)).toEqual([]);
  });

  test("datedMemories: live rows whose date overlaps the window, earliest first — months and ranges included", () => {
    const s = store();
    const taxes = s.put({ type: "memory", kind: "fact", body: "taxes", eventDate: "2026-10-15" });
    const launch = s.put({ type: "memory", kind: "fact", body: "launch", eventDate: "2026-10" });
    const trip = s.put({ type: "memory", kind: "fact", body: "trip", eventDate: "2026-10-20..2026-10-31" });
    const later = s.put({ type: "memory", kind: "fact", body: "later", eventDate: "2026-11-02" });
    const gone = s.put({ type: "memory", kind: "fact", body: "gone", eventDate: "2026-10-15" });
    s.put({ type: "memory", kind: "fact", body: "undated" });
    s.archive(gone, "test");

    expect(s.datedMemories("2026-10-15", "2026-10-15").map((d) => d.id)).toEqual([launch, taxes]);
    expect(s.datedMemories("2026-10-31", "2026-11-05").map((d) => d.id)).toEqual([launch, trip, later]);
    expect(s.datedMemories("2026-10-20", "2026-10-20")).toEqual([
      { id: launch, eventDate: "2026-10" },
      { id: trip, eventDate: "2026-10-20..2026-10-31" },
    ]);
    expect(s.datedMemories("2026-12-01", "2026-12-31")).toEqual([]);
  });

  test("a reschedule archives the old date with the version; null clears it", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "dentist", eventDate: "2026-10-15" });
    s.revise(id, { eventDate: "2026-10-22", reason: "rescheduled" });
    expect(s.readProse(id).eventDate).toBe("2026-10-22");
    expect(s.readVersion(id, 1).eventDate).toBe("2026-10-15");
    s.revise(id, { eventDate: null, reason: "cancelled" });
    expect(s.readProse(id).eventDate).toBeUndefined();
    expect(s.datedMemories("2026-10-01", "2026-10-31")).toEqual([]);
  });
});

describe("a removal takes the v7 facts with the words", () => {
  test("the chase blanks moments, model and date on the row and on its versions", () => {
    const s = store();
    const id = s.put({ type: "memory", kind: "fact", body: "private", model: "claude-opus-5-5", eventDate: "2026-10-15" });
    s.revise(id, { body: "private, again", model: "claude-opus-5-5" });
    s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
    s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
    chaseRemoved(s, id);
    const row = s.row(id);
    expect([row?.created_at, row?.updated_at, row?.model, row?.event_date]).toEqual([null, null, null, null]);
    expect(s.versions(id).map((v) => [v.created_at, v.model, v.event_date])).toEqual([[null, null, null]]);
  });
});
