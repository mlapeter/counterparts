/**
 * Schema v14 (2026-10-21, wave 2's one bump): five pre-provisioned tables
 * (`memory_tags`, `tag_merges`, `belief_support`, `folder_projects`,
 * `recall_turns`), four `memories` columns (`subject_kind`, `birth_route`,
 * `confidence`, `birth_salience`), the cards' deterministic subject kinds,
 * and the first non-additive step since v6 — `memories.confidential` dropped,
 * after the retirement's count when no open had taken it.
 *
 * The v13 fixture is a fresh store with v14 stripped (`stripV14`) and its
 * stamp set back. Hermetic: a temp dir per test.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sal } from "../src/core/physics/index.js";
import {
  CONFIDENTIAL_RETIRED_KEY,
  OBSERVER_READ_FLOOR,
  SCHEMA_VERSION,
  Store,
  V14_UPGRADE_KEY,
  isStoreError,
  paths,
} from "../src/core/store/index.js";
import type { StoreOptions } from "../src/core/store/index.js";
import { chaseRemoved } from "../src/core/store/owner-op-seam.js";
import { V14_COLUMNS, V14_INDEXES, V14_TABLES, stripV13, stripV14 } from "./store-fixture.js";

let root: string;
let dir: string;
const open: Store[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-v14-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Omit<StoreOptions, "dir"> = {}, at = dir): Store {
  const s = Store.open({ dir: at, snapshotsDir: join(root, "snaps"), ...opts });
  open.push(s);
  return s;
}

function closeAll(): void {
  for (const s of open.splice(0)) s.close();
}

function card(s: Store, kind: "person" | "place" | "entity", name: string): string {
  return s.put({ type: "schema", kind, title: name, body: name, meta: { role: "entity", name, aliases: [] } });
}

function cols(path: string, table: string): string {
  const d = new Database(path, { readonly: true });
  try {
    return JSON.stringify(d.query(`PRAGMA table_info(${table})`).all());
  } finally {
    d.close();
  }
}

function names(path: string): Set<string> {
  const d = new Database(path, { readonly: true });
  try {
    return new Set((d.query("SELECT name FROM sqlite_master").all() as { name: string }[]).map((r) => r.name));
  } finally {
    d.close();
  }
}

/**
 * A v13 store, as one written before this build: people, a place, a
 * project, the identity core, the self page, and a memory that carried the
 * retired confidential mark. `counted` leaves the retirement row in place
 * (an open of the confidential removal's build already counted it).
 */
function v13Store(counted = false): { secret: string; plain: string; person: string; place: string; project: string; core: string; page: string } {
  const s = store();
  s.advanceClock("2026-10-01");
  const plain = s.put({ type: "memory", kind: "fact", body: "The standup moved to nine on Mondays." });
  const secret = s.put({ type: "memory", kind: "fact", body: "The loan terms are between us." });
  const person = card(s, "person", "Katie");
  const place = card(s, "place", "Lisbon");
  const project = card(s, "entity", "Counterparts");
  const core = s.put({ type: "schema", kind: "self", title: "Mike", body: "Mike", meta: { role: "entity", name: "Mike", aliases: [] } });
  const page = s.put({ type: "schema", kind: "self", title: "Self", body: "Who I am.", meta: { role: "page" } });
  closeAll();
  const db = new Database(paths.operational(dir));
  stripV14(db);
  db.run("UPDATE memories SET confidential = 1 WHERE id = ?", [secret]);
  if (!counted) db.run("DELETE FROM meta WHERE key = ?", [CONFIDENTIAL_RETIRED_KEY]);
  db.run("UPDATE meta SET value = '13' WHERE key = 'schemaVersion'");
  db.close();
  return { secret, plain, person, place, project, core, page };
}

describe("store v14 — wave 2's one bump", () => {
  test("the version is 14 and the observer floor stays at 11", () => {
    expect(SCHEMA_VERSION).toBe(14);
    expect(OBSERVER_READ_FLOOR).toBe(11);
  });

  test("a fresh store has no confidential column, the four columns last, every table and index, and a retirement row of 0", () => {
    store();
    closeAll();
    const op = paths.operational(dir);
    const memCols = (JSON.parse(cols(op, "memories")) as { name: string }[]).map((c) => c.name);
    expect(memCols).not.toContain("confidential");
    expect(memCols.slice(-4)).toEqual([...V14_COLUMNS]);
    const have = names(op);
    for (const n of [...V14_TABLES, ...V14_INDEXES]) expect(have.has(n)).toBe(true);
    const s = store();
    expect(JSON.parse(s.getMeta(CONFIDENTIAL_RETIRED_KEY) ?? "{}")).toMatchObject({ count: 0, ids: [] });
    expect(s.getMeta(V14_UPGRADE_KEY)).toBeUndefined();
  });

  test("a v13 store migrates after a copy: counted, then dropped; subject kinds given; fresh and migrated converge", () => {
    const ids = v13Store();
    // An observer reads the v13 file as it stands, and the new reads answer "none yet".
    const reader = store({ observer: true });
    expect(reader.getMeta("schemaVersion")).toBe("13");
    expect(reader.row(ids.plain)?.body).toContain("standup");
    expect(reader.tagsOf(ids.plain)).toEqual([]);
    expect(reader.supportOf(ids.plain)).toEqual([]);
    expect(reader.recallTurns()).toEqual([]);
    expect(reader.projectOfFolder("/x")).toBeNull();
    expect(reader.selfSubject()).toBeNull();
    closeAll();

    const s = store();
    expect(s.getMeta("schemaVersion")).toBe("14");
    expect(readdirSync(join(root, "snaps")).filter((n) => n.includes("pre-migration-v13-to-v14"))).toHaveLength(1);
    // The retirement was counted BEFORE the drop, once.
    const retired = JSON.parse(s.getMeta(CONFIDENTIAL_RETIRED_KEY) ?? "{}") as Record<string, unknown>;
    expect(retired["count"]).toBe(1);
    expect(retired["ids"]).toEqual([ids.secret]);
    const up = JSON.parse(s.getMeta(V14_UPGRADE_KEY) ?? "{}") as Record<string, unknown>;
    expect(up).toMatchObject({ from: "13", confidentialDropped: true, confidentialCounted: 1, subjects: { person: 2, place: 1 } });
    // Subject kinds: people and places, and the identity core (the owner's card) a person; the rest wait.
    expect(s.row(ids.person)?.subject_kind).toBe("person");
    expect(s.row(ids.place)?.subject_kind).toBe("place");
    expect(s.row(ids.core)?.subject_kind).toBe("person");
    expect(s.row(ids.project)?.subject_kind).toBeNull();
    expect(s.row(ids.page)?.subject_kind).toBeNull();
    expect(s.row(ids.plain)?.subject_kind).toBeNull();
    // Rows written before: no birth salience, no belief fields.
    expect(s.row(ids.plain)?.birth_salience).toBeNull();
    expect(s.row(ids.plain)?.birth_route).toBeNull();
    expect(s.read(ids.secret).doc.body).toContain("loan");
    closeAll();

    const op = paths.operational(dir);
    expect((JSON.parse(cols(op, "memories")) as { name: string }[]).map((c) => c.name)).not.toContain("confidential");
    const have = names(op);
    for (const n of [...V14_TABLES, ...V14_INDEXES]) expect(have.has(n)).toBe(true);
    const fresh = join(root, "fresh");
    store({}, fresh);
    closeAll();
    for (const t of ["memories", "versions", ...V14_TABLES]) {
      expect(cols(op, t)).toBe(cols(paths.operational(fresh), t));
    }
    const d = new Database(op, { readonly: true });
    expect((d.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
    d.close();
  });

  test("a v13 store already counted keeps its retirement row; the upgrade says it counted nothing itself", () => {
    const ids = v13Store(true);
    const s = store();
    const retired = JSON.parse(s.getMeta(CONFIDENTIAL_RETIRED_KEY) ?? "{}") as Record<string, unknown>;
    // Counted at the fresh store's birth, before the fixture marked one: 0, and left as it was.
    expect(retired["count"]).toBe(0);
    expect(JSON.parse(s.getMeta(V14_UPGRADE_KEY) ?? "{}")).toMatchObject({ confidentialDropped: true, confidentialCounted: null });
    expect(s.row(ids.secret)?.["confidential"]).toBeUndefined();
  });

  test("a v12 store goes to v14 in one open, and the drop is guarded: a file without the column migrates", () => {
    store().put({ type: "memory", kind: "fact", body: "A v12 memory." });
    closeAll();
    let db = new Database(paths.operational(dir));
    stripV13(db);
    db.run("UPDATE meta SET value = '12' WHERE key = 'schemaVersion'");
    db.close();
    const s = store();
    expect(s.getMeta("schemaVersion")).toBe("14");
    expect(JSON.parse(s.getMeta(V14_UPGRADE_KEY) ?? "{}")).toMatchObject({ from: "12", confidentialDropped: true });
    closeAll();
    // No column at all (a hand-lowered stamp on a v14 file): nothing to drop, and the open still migrates.
    db = new Database(paths.operational(dir));
    db.run("UPDATE meta SET value = '13' WHERE key = 'schemaVersion'");
    db.close();
    const again = store();
    expect(again.getMeta("schemaVersion")).toBe("14");
    expect(JSON.parse(again.getMeta(V14_UPGRADE_KEY) ?? "{}")).toMatchObject({ from: "13", confidentialDropped: false, confidentialCounted: null });
  });

  test("the copy taken before migrating is the way back: restored, it is the v13 store with its column", () => {
    const ids = v13Store();
    const s = store();
    s.put({ type: "memory", kind: "fact", body: "Written after the upgrade." });
    closeAll();
    const snap = readdirSync(join(root, "snaps")).find((n) => n.includes("pre-migration-v13-to-v14")) as string;
    const live = paths.operational(dir);
    for (const extra of ["-wal", "-shm"]) rmSync(`${live}${extra}`, { force: true });
    copyFileSync(join(root, "snaps", snap, "counterparts.sqlite"), live);
    const d = new Database(live, { readonly: true });
    expect((d.query("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string }).value).toBe("13");
    expect((d.query("SELECT confidential FROM memories WHERE id = ?").get(ids.secret) as { confidential: number }).confidential).toBe(1);
    d.close();
  });
});

describe("store v14 — the new columns and tables, round trip", () => {
  test("birth salience is sal() of what the row was written with, and stays when the dimensions are rewritten", () => {
    const s = store();
    const salience = { novelty: 0.2, relevance: 0.6, emotional: 0.3, predictive: 0.4, claimed: null };
    const id = s.put({ type: "memory", kind: "fact", body: "A measured thing.", salience });
    expect(s.row(id)?.birth_salience).toBeCloseTo(sal(salience), 10);
    s.updatePhysics(id, { salience: { ...salience, relevance: 0.9, claimed: 0.9 } });
    expect(s.row(id)?.birth_salience).toBeCloseTo(sal(salience), 10);
  });

  test("subject kind and birth route at birth, after, and refused when not in the list", () => {
    const s = store();
    const c = s.put({ type: "schema", kind: "entity", title: "Counterparts", body: "Counterparts", meta: { role: "entity", name: "Counterparts" }, subjectKind: "project" });
    expect(s.row(c)?.subject_kind).toBe("project");
    expect(s.subjectsOfKind("project")).toEqual([c]);
    s.setSubjectKind(c, "topic");
    expect(s.row(c)?.subject_kind).toBe("topic");
    s.setSubjectKind(c, null);
    expect(s.row(c)?.subject_kind).toBeNull();
    expect(() => s.setSubjectKind(c, "planet" as "topic")).toThrow();
    const odd = s.put({ type: "memory", kind: "fact", body: "Not a subject.", subjectKind: "planet" as "topic", birthRoute: "osmosis" as "dream" });
    expect(s.row(odd)?.subject_kind).toBeNull();
    expect(s.row(odd)?.birth_route).toBeNull();
    const b = s.put({ type: "schema", kind: "fact", body: "I like plain words.", meta: { role: "belief", entityId: c }, birthRoute: "reflection" });
    expect(s.row(b)?.birth_route).toBe("reflection");
    s.setBeliefFields(b, { birthRoute: "correction", confidence: 0.3 });
    expect(s.row(b)?.birth_route).toBe("correction");
    expect(s.row(b)?.confidence).toBe(0.3);
    try {
      s.setBeliefFields(b, { birthRoute: "osmosis" as "dream" });
      throw new Error("not refused");
    } catch (err) {
      expect(isStoreError(err, "BIRTH_ROUTE_INVALID")).toBe(true);
    }
  });

  test("the self subject: made once, an entity card that is not the identity core, kind fact, subject_kind self", () => {
    const s = store();
    expect(s.selfSubject()).toBeNull();
    const me = s.ensureSelfSubject();
    expect(s.ensureSelfSubject()).toBe(me);
    expect(s.selfSubject()).toBe(me);
    const row = s.row(me);
    expect(row?.type).toBe("schema");
    expect(row?.kind).toBe("fact");
    expect(row?.subject_kind).toBe("self");
    expect(JSON.parse(row?.meta ?? "{}")).toMatchObject({ role: "entity", name: "" });
    expect(s.list({ type: "schema", kind: "self" })).not.toContain(me);
  });

  test("tags: normalized, counted once, untagged, listed both ways; concept edges by a self-join; merges recorded and undone", () => {
    const s = store();
    const a = s.put({ type: "memory", kind: "fact", body: "Taxes are due in April." });
    const b = s.put({ type: "memory", kind: "fact", body: "The tax deadline moved." });
    const c = s.put({ type: "memory", kind: "fact", body: "Lunch with Katie." });
    expect(s.tagMemory(a, ["Taxes", " deadlines ", "taxes", ""], "write")).toBe(2);
    expect(s.tagMemory(a, ["taxes"], "night")).toBe(0);
    s.tagMemory(b, ["taxes", "deadlines", "april"], "night");
    s.tagMemory(c, ["katie"], "write");
    expect(s.tagsOf(a).map((t) => [t.tag, t.via])).toEqual([["deadlines", "write"], ["taxes", "write"]]);
    expect(s.memoriesTagged("TAXES")).toEqual([a, b].sort());
    expect(s.tagCounts().slice(0, 2)).toEqual([{ tag: "deadlines", memories: 2 }, { tag: "taxes", memories: 2 }]);
    expect(s.tagNeighbours(["taxes"])).toEqual([{ tag: "deadlines", together: 2 }, { tag: "april", together: 1 }]);
    s.archive(b, "test");
    expect(s.tagNeighbours(["taxes"])).toEqual([{ tag: "deadlines", together: 1 }]);
    expect(s.memoriesTagged("taxes")).toEqual([a]);
    expect(s.memoriesTagged("taxes", { archived: true })).toEqual([a, b].sort());
    expect(s.untagMemory(a, ["deadlines"])).toBe(1);
    expect(s.untagMemory(b)).toBe(3);
    expect(s.recordTagMerge("Tax", "taxes", "night")).toBe(true);
    expect(s.recordTagMerge("taxes", "taxes", "night")).toBe(false);
    expect(s.tagMerges().map((m) => [m.alias, m.tag, m.via])).toEqual([["tax", "taxes", "night"]]);
    expect(s.undoTagMerge("tax")).toBe(true);
    expect(s.undoTagMerge("tax")).toBe(false);
    expect(s.tagMerges()).toEqual([]);
  });

  test("support: each memory counted once per belief, for or against, with where it came from by a join", () => {
    const s = store();
    s.advanceClock("2026-10-01");
    const belief = s.put({ type: "schema", kind: "fact", body: "Mike likes plain words.", meta: { role: "belief" }, birthRoute: "reflection" });
    const m1 = s.put({ type: "memory", kind: "fact", body: "Mike asked for plainer copy.", origin: { session: "sess-a", scope: "/work/site" } });
    s.advanceClock("2026-10-02");
    const m2 = s.put({ type: "memory", kind: "fact", body: "Mike kept the jargon in the README.", origin: { session: "sess-b", scope: "/work/repo" } });
    expect(s.fileSupport({ beliefId: belief, memoryId: m1, stance: "support", route: "session", day: 1, weight: 1 })).toBe(true);
    // Re-citing what was counted adds nothing, whatever it says the second time.
    expect(s.fileSupport({ beliefId: belief, memoryId: m1, stance: "support", route: "reflection", day: 2, weight: 0.5 })).toBe(false);
    expect(s.fileSupport({ beliefId: belief, memoryId: m2, stance: "contrary", route: "session", day: 2, weight: 1 })).toBe(true);
    expect(s.fileSupport({ beliefId: belief, memoryId: belief, stance: "support", route: "reflection", day: 2, weight: 1 })).toBe(false);
    const rows = s.supportOf(belief);
    expect(rows.map((r) => [r.memoryId, r.stance, r.route, r.day, r.weight])).toEqual([
      [m1, "support", "session", 1, 1],
      [m2, "contrary", "session", 2, 1],
    ]);
    expect(rows.map((r) => [r.session, r.scope])).toEqual([
      ["sess-a", "/work/site"],
      ["sess-b", "/work/repo"],
    ]);
    expect(rows[0]?.bornDay).toBe(s.row(m1)?.birth_day as number);
    expect(s.supportGivenBy(m2).map((r) => r.beliefId)).toEqual([belief]);
    expect(s.unfileSupport(belief, m2)).toBe(true);
    expect(s.supportOf(belief)).toHaveLength(1);
  });

  test("folders and projects: one project per folder, replaced, cleared; the card must exist", () => {
    const s = store();
    const p = s.put({ type: "schema", kind: "entity", title: "Counterparts", body: "Counterparts", meta: { role: "entity", name: "Counterparts" }, subjectKind: "project" });
    const q = s.put({ type: "schema", kind: "entity", title: "Site", body: "Site", meta: { role: "entity", name: "Site" }, subjectKind: "project" });
    s.setFolderProject("/work/counterparts", p, "owner");
    s.setFolderProject("/work/counterparts-site", p, "night");
    expect(s.projectOfFolder("/work/counterparts")).toMatchObject({ project_id: p, via: "owner" });
    expect(s.foldersOfProject(p)).toEqual(["/work/counterparts", "/work/counterparts-site"]);
    s.setFolderProject("/work/counterparts-site", q, "owner");
    expect(s.foldersOfProject(p)).toEqual(["/work/counterparts"]);
    expect(s.clearFolderProject("/work/counterparts")).toBe(true);
    expect(s.clearFolderProject("/work/counterparts")).toBe(false);
    expect(s.projectOfFolder("/work/counterparts")).toBeNull();
    expect(() => s.setFolderProject("/elsewhere", "sch_missing00000", "owner")).toThrow();
  });

  test("recall turns: one row per turn, recorded again replaces, read per session or since a day", () => {
    const s = store();
    s.recordRecallTurn({ sessionId: "s1", turn: 1, day: 3, candidates: 40, shown: ["mem_a", "mem_b"] });
    s.recordRecallTurn({ sessionId: "s1", turn: 2, day: 3, candidates: 12, shown: [] });
    s.recordRecallTurn({ sessionId: "s2", turn: 1, day: 5, candidates: 7, shown: ["mem_c"] });
    s.recordRecallTurn({ sessionId: "s1", turn: 2, day: 3, candidates: 13, shown: ["mem_a"] });
    const s1 = s.recallTurns({ sessionId: "s1" });
    expect(s1.map((t) => [t.turn, t.candidates, JSON.parse(t.shown)])).toEqual([
      [1, 40, ["mem_a", "mem_b"]],
      [2, 13, ["mem_a"]],
    ]);
    expect(s.recallTurns({ sinceDay: 4 }).map((t) => t.session_id)).toEqual(["s2"]);
  });

  test("the writes refuse under observer", () => {
    store().close();
    open.splice(0);
    const r = store({ observer: true });
    expect(() => r.tagMemory("mem_x", ["a"], "write")).toThrow();
    expect(() => r.ensureSelfSubject()).toThrow();
    expect(() => r.recordRecallTurn({ sessionId: "s", turn: 1, day: 1, candidates: 0, shown: [] })).toThrow();
  });
});

describe("store v14 — the owner's removal reaches every new table", () => {
  test("a removed memory's tags, its support on both sides, its id in recall turns; a removed card's folders", () => {
    const s = store();
    const project = s.put({ type: "schema", kind: "entity", title: "Atlas", body: "Atlas", meta: { role: "entity", name: "Atlas" }, subjectKind: "project" });
    const belief = s.put({ type: "schema", kind: "fact", body: "Atlas ships on Fridays.", meta: { role: "belief", entityId: project }, birthRoute: "reflection" });
    const gone = s.put({ type: "memory", kind: "fact", body: "We shipped Atlas on a Friday again." });
    const kept = s.put({ type: "memory", kind: "fact", body: "Atlas has a Friday release train." });
    s.tagMemory(gone, ["atlas", "fridays"], "write");
    s.tagMemory(kept, ["atlas"], "write");
    s.fileSupport({ beliefId: belief, memoryId: gone, stance: "support", route: "session", day: 1, weight: 1 });
    s.fileSupport({ beliefId: belief, memoryId: kept, stance: "support", route: "session", day: 1, weight: 1 });
    s.fileSupport({ beliefId: gone, memoryId: kept, stance: "support", route: "session", day: 1, weight: 1 });
    s.recordRecallTurn({ sessionId: "s1", turn: 1, day: 1, candidates: 9, shown: [kept, gone] });
    s.setFolderProject("/work/atlas", project, "owner");
    s.setFolderProject("/work/other", belief, "owner");

    const remove = (id: string): void => {
      s.appendRemovalRecord({ memoryId: id, stage: "requested", actor: "owner", reason: "test" });
      s.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "test" });
      chaseRemoved(s, id);
    };
    remove(gone);
    expect(s.tagsOf(gone)).toEqual([]);
    expect(s.tagsOf(kept).map((t) => t.tag)).toEqual(["atlas"]);
    expect(s.supportOf(belief).map((r) => r.memoryId)).toEqual([kept]);
    expect(s.supportOf(gone)).toEqual([]);
    expect(s.supportGivenBy(kept).map((r) => r.beliefId)).toEqual([belief]);
    const turn = s.recallTurns({ sessionId: "s1" })[0];
    expect(JSON.parse(turn?.shown ?? "[]")).toEqual([kept]);
    expect(turn?.candidates).toBe(9);

    // The skeleton keeps none of the v14 fields either.
    expect(s.row(gone)).toMatchObject({ subject_kind: null, birth_route: null, confidence: null, birth_salience: null });

    remove(project);
    expect(s.projectOfFolder("/work/atlas")).toBeNull();
    expect(s.row(project)?.subject_kind).toBeNull();
    expect(s.projectOfFolder("/work/other")).toMatchObject({ project_id: belief });
  });
});
