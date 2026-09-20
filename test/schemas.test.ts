/**
 * schemas/ — semantic memory: birth by mention, death by decay, revision by
 * pressure, and the placement rule.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir
 * in beforeEach and removes ONLY that path in afterEach. Nothing here can reach
 * a real store.
 *
 * Assertions name the REASON — `BirthReason`, `RevisionReason`, `FadeReason`,
 * `PlacementReason`. An entity that is absent because the name was not in the
 * span and one absent because the chunk already spent its birth are different
 * systems, and a test that cannot tell them apart is the test v1 shipped: its
 * gate recorded zero births AND zero refusals and nobody could say which.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "../src/core/store/index.js";
import type { PutInput, StoreEvent } from "../src/core/store/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { makeStore } from "./store-fixture.js";
// The real removal command, not the raw seam: the crash this file pins was
// reachable only through the whole ceremony (dark → files → chase → complete),
// and a test that appends the stages by hand would not have caught it.
import { ownerRemoval } from "../src/adapters/cli/removal.js";
import { TUNABLES as PHYSICS, pruneVerdict, sal } from "../src/core/physics/index.js";
import { occursAsWholeWord } from "../src/core/encode/words.js";
import { preselectSchemas, renderSchemaContext } from "../src/core/encode/preselect.js";
import {
  BIRTH_KINDS,
  PUBLIC_SURFACE,
  SCHEMA_ROLES,
  Schemas,
  TUNABLES,
  collision,
  isBirthKind,
} from "../src/core/schemas/index.js";
import type { SchemaEvent } from "../src/core/schemas/index.js";

const SCHEMAS_SRC = fileURLToPath(new URL("../src/core/schemas/", import.meta.url));

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-schemas-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

const events: SchemaEvent[] = [];

function schemas(): Schemas {
  const store = Store.open({ dir });
  open.push(store);
  events.length = 0;
  return Schemas.open({ store, onEvent: (e) => events.push(e) });
}

/** A memory the store already holds, so a challenge has a real challenger. */
function challenger(store: Store, opts: { day: number; salience: number; body: string }): string {
  const input: PutInput = {
    type: "memory",
    kind: "person",
    body: opts.body,
    salience: {
      novelty: null,
      relevance: opts.salience,
      emotional: opts.salience,
      predictive: opts.salience,
    },
    physics: { birthDay: opts.day, lastUsedDay: opts.day },
  };
  return store.put(input);
}

// ---------------------------------------------------------------------------
// Birth by mention
// ---------------------------------------------------------------------------

describe("birth by mention", () => {
  test("a newly-named entity becomes a stub immediately, with a logged creation event", () => {
    const s = schemas();
    const out = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "spent the evening on Bansai, the memory system",
      chunkRef: "c1",
      day: 0,
    });

    expect(out.reason).toBe("born");
    expect(out.born).toBe(true);
    expect(out.id).not.toBeNull();

    // No gate, no proposal queue: the birth is the event, and it is explicit.
    const birth = s.events("schema.birth");
    expect(birth).toHaveLength(1);
    expect(birth[0]?.ref).toBe(out.id as string);

    // The proposal is logged too, not only the outcome (scar §2.4).
    expect(s.events("schema.mention")).toHaveLength(1);

    // ... and the name is never in the payload: it is author content the store
    // indexes, logged by hash exactly the way encode logs a dropped alias.
    for (const e of s.events()) {
      expect(JSON.stringify(e.data ?? {})).not.toContain("Bansai");
    }
  });

  test("a newborn schema asserts nothing — names only, and zero salience", () => {
    const s = schemas();
    const out = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai again",
      chunkRef: "c1",
      day: 0,
      aliases: ["bans.ai"],
    });
    const id = out.id as string;

    const view = s.entity(id);
    expect(view?.name).toBe("Bansai");
    expect(s.beliefs(id)).toHaveLength(0);
    expect(s.currentState(id)).toHaveLength(0);

    const p = s.store.physicsOf(id);
    expect(sal(p.salience)).toBe(0);
    // Novelty is RECORDED as null for an engine mint, never defaulted (scar §2.9).
    expect(p.salience.novelty).toBeNull();
    // Nothing is born into identity, whatever else is true.
    expect(p.promotedIdentity).toBe(false);
    expect(s.bandOf(id, 0)).toBe("episodic");
  });

  test("the name must occur in the source as a whole word — the ONE definition", () => {
    const s = schemas();
    const out = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "worked on the memory layer today",
      chunkRef: "c1",
      day: 0,
    });
    expect(out.reason).toBe("name-not-in-source");
    expect(out.id).toBeNull();
    expect(s.events("schema.birth")).toHaveLength(0);
    expect(s.events("schema.birth.refused")[0]?.data?.["reason"]).toBe("name-not-in-source");
  });

  test("hyphens are word characters, so a name inside a hyphenation is NOT in the source", () => {
    const s = schemas();
    // v1's measured false positive, in the other direction: "self" must not
    // match "self-contained", and birth must agree with preselection exactly.
    const source = "the bansai-site deploy is green";
    expect(occursAsWholeWord(source, "bansai")).toBe(false);
    const out = s.mention({ name: "bansai", kind: "entity", source, chunkRef: "c1", day: 0 });
    expect(out.reason).toBe("name-not-in-source");
  });

  test("never a second self — refused independently of every other ground", () => {
    const s = schemas();
    const out = s.mention({
      name: "Mike",
      kind: "self",
      source: "Mike said the thing",
      chunkRef: "c1",
      day: 0,
    });
    expect(out.reason).toBe("second-self-refused");
    expect(isBirthKind("self")).toBe(false);
    expect(BIRTH_KINDS).not.toContain("self" as never);
  });

  test("a name that resolves to the identity core is refused as a second self, not merged", () => {
    const store = Store.open({ dir });
    open.push(store);
    // The self schema is `self/`'s to mint; birth refuses kind self, so the test
    // creates it the way that module would.
    store.put({
      type: "schema",
      kind: "self",
      title: "self",
      body: "# self\n\nthe identity core\n",
      meta: { role: "entity", name: "self", aliases: [] },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const s = Schemas.open({ store });
    const out = s.mention({
      name: "self",
      kind: "person",
      source: "talking about self here",
      chunkRef: "c1",
      day: 0,
    });
    expect(out.reason).toBe("second-self-refused");
  });

  test("a fact is a memory, not an entity: the kind is refused by name", () => {
    const s = schemas();
    const out = s.mention({
      name: "Paris",
      kind: "fact",
      source: "Paris is the capital",
      chunkRef: "c1",
      day: 0,
    });
    expect(out.reason).toBe("kind-not-allowed");
  });

  test("a credential never becomes an entity the store indexes", () => {
    const s = schemas();
    const key = `AKIA${"A1B2C3D4E5F6G7H8"}`;
    const out = s.mention({
      name: key,
      kind: "entity",
      source: `the key ${key} showed up in the log`,
      chunkRef: "c1",
      day: 0,
    });
    expect(out.reason).toBe("name-is-secret");
    expect(s.entities()).toHaveLength(0);
  });

  test("stub dedup: mentioning the same name twice births ONCE", () => {
    const s = schemas();
    const first = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai shipped",
      chunkRef: "c1",
      day: 0,
    });
    const second = s.mention({
      name: "bansai",
      kind: "entity",
      source: "bansai again the next day",
      chunkRef: "c2",
      day: 3,
    });

    expect(first.reason).toBe("born");
    expect(second.reason).toBe("existing");
    expect(second.born).toBe(false);
    expect(second.id).toBe(first.id as string);
    expect(s.entities()).toHaveLength(1);
    expect(s.events("schema.birth")).toHaveLength(1);
    // The second mention is the entity being USED, and it is credited as one.
    expect(second.reinforced).toBe(true);
    expect(s.store.physicsOf(first.id as string).reinforcedDays).toBe(1);
  });

  test("a re-mention on the SAME lived day credits nothing (physics refuses, with a reason)", () => {
    const s = schemas();
    const first = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai",
      chunkRef: "c1",
      day: 0,
    });
    const again = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai",
      chunkRef: "c1",
      day: 0,
    });
    expect(again.reason).toBe("existing");
    expect(again.reinforced).toBe(false);
    expect(s.events("schema.mention.existing")[0]?.data?.["creditReason"]).toBe("birth-day");
    expect(s.entities()).toHaveLength(1);
    expect(first.id).toBe(again.id as string);
  });

  test("at most one birth per chunk — the second NEW name is refused, the cap named", () => {
    const s = schemas();
    const source = "Bansai and Counterparts both came up";
    const a = s.mention({ name: "Bansai", kind: "entity", source, chunkRef: "c1", day: 0 });
    const b = s.mention({ name: "Counterparts", kind: "entity", source, chunkRef: "c1", day: 0 });
    expect(a.reason).toBe("born");
    expect(b.reason).toBe("birth-cap-per-chunk");
    expect(s.entities()).toHaveLength(1);
    expect(TUNABLES.MAX_BIRTHS_PER_CHUNK).toBe(1);

    // A different chunk gets its own budget.
    const c = s.mention({ name: "Counterparts", kind: "entity", source, chunkRef: "c2", day: 0 });
    expect(c.reason).toBe("born");
  });

  test("dedup does not consume the chunk's birth budget", () => {
    const s = schemas();
    const source = "Bansai, then Bansai, then Counterparts";
    s.mention({ name: "Bansai", kind: "entity", source, chunkRef: "c1", day: 0 });
    const dup = s.mention({ name: "Bansai", kind: "entity", source, chunkRef: "c1", day: 0 });
    const other = s.mention({ name: "Counterparts", kind: "entity", source, chunkRef: "c1", day: 0 });
    expect(dup.reason).toBe("existing");
    // The budget was spent by the birth, not by the repeat — but it IS spent.
    expect(other.reason).toBe("birth-cap-per-chunk");
  });

  test("near collisions refuse LOUDLY rather than merging, and name what they hit", () => {
    const s = schemas();
    const first = s.mention({
      name: "Mike",
      kind: "person",
      source: "Mike called",
      chunkRef: "c1",
      day: 0,
    });
    const second = s.mention({
      name: "Mike Chen",
      kind: "person",
      source: "Mike Chen called",
      chunkRef: "c2",
      day: 1,
    });
    expect(second.reason).toBe("collision-near");
    expect(second.collidedWith).toEqual([first.id as string]);
    expect(s.entities()).toHaveLength(1);
    expect(collision("Mike", "Mike Chen")).toBe("near");
    expect(collision("Mike", "Mike")).toBe("exact");
    expect(collision("Mike", "Sara")).toBe("none");
  });

  test("an exact name on a different kind is a collision, not a dedup", () => {
    const s = schemas();
    s.mention({ name: "Ada", kind: "person", source: "Ada spoke", chunkRef: "c1", day: 0 });
    const out = s.mention({
      name: "Ada",
      kind: "skill",
      source: "Ada spoke",
      chunkRef: "c2",
      day: 0,
    });
    expect(out.reason).toBe("collision-exact-different-kind");
  });

  test("aliases are verified individually and DROPPED rather than fatal", () => {
    const s = schemas();
    const out = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, aka cparts, is the successor",
      chunkRef: "c1",
      day: 0,
      aliases: ["cparts", "never-said-this"],
    });
    expect(out.reason).toBe("born");
    expect(out.keptAliases).toEqual(["cparts"]);
    expect(out.droppedAliases.map((d) => d.reason)).toEqual(["alias-not-verbatim-in-source"]);
    // By INDEX, never by text — an alias is author content.
    expect(out.droppedAliases[0]?.index).toBe(1);
  });

  test("an alias already pointing at another entity is dropped, not shared", () => {
    const s = schemas();
    s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai, aka bans, shipped",
      chunkRef: "c1",
      day: 0,
      aliases: ["bans"],
    });
    const second = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, aka bans, is next",
      chunkRef: "c2",
      day: 0,
      aliases: ["bans"],
    });
    expect(second.reason).toBe("born");
    expect(second.keptAliases).toEqual([]);
    expect(second.droppedAliases.map((d) => d.reason)).toEqual(["alias-resolves-elsewhere"]);
    expect(s.aliasIndex().lookup("bans")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Death by decay — the other half of the lifecycle
// ---------------------------------------------------------------------------

describe("death by decay", () => {
  test("born on mention; pruned-eligible when it never accumulates", () => {
    const s = schemas();
    const id = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral came up once",
      chunkRef: "c1",
      day: 0,
    }).id as string;

    // Day one: alive, and blocked from fading for a reason it can name.
    const young = s.fadeVerdict(id, 1);
    expect(young.fade).toBe(false);
    expect(young.reason).toBe("dwell-too-short");
    expect(young.blockedBy).toEqual(["dwell-too-short"]);

    // A stub nobody mentions again has zero salience and zero uses, so it sits
    // at the floor and, after the dwell, it is prunable by ordinary physics.
    const late = D_FLOOR();
    const old = s.fadeVerdict(id, late);
    expect(old.strength).toBe(0);
    expect(old.band).toBe("episodic");
    expect(old.blockedBy).toEqual([]);
    expect(old.reason).toBe("faded");
    expect(old.fade).toBe(true);

    // The same verdict physics would give on its own: no second opinion here.
    expect(pruneVerdict(s.store.physicsOf(id), late, { inLiveRevisionChain: false }).prune).toBe(
      true,
    );

    const report = s.fadeSweep(late);
    expect(report.faded).toEqual([id]);
    expect(s.entities()).toHaveLength(0);
    // Archive is a STATE, not a deletion: the id stays resolvable.
    expect(s.store.resolve(id)).toBe(id);
    expect(s.entity(id)?.archived).toBe(true);
    expect(s.entity(id)?.archivedReason).toBe(TUNABLES.FADE_REASON);
    expect(s.events("schema.faded")).toHaveLength(1);
  });

  test("an entity that accumulates survives the same sweep", () => {
    const s = schemas();
    const id = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, day one",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    // One re-mention on a later lived day is one credited use.
    const again = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, day five",
      chunkRef: "c2",
      day: 5,
    });
    expect(again.reinforced).toBe(true);

    const late = 5 + PHYSICS.D_FLOOR_DAYS;
    const v = s.fadeVerdict(id, late);
    expect(v.fade).toBe(false);
    expect(v.blockedBy).toEqual(["above-floor"]);
    expect(v.strength).toBeGreaterThan(PHYSICS.PHI_PRUNE);
    expect(s.fadeSweep(late).faded).toEqual([]);
    expect(s.entities().map((e) => e.id)).toEqual([id]);
  });

  test("an entity with live beliefs attached does not fade, and says so", () => {
    const s = schemas();
    const id = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral came up once",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    s.addBelief({ entityId: id, statement: "it ships on Fridays", day: 0 });

    const v = s.fadeVerdict(id, D_FLOOR());
    expect(v.fade).toBe(false);
    expect(v.attached).toBe(1);
    expect(v.blockedBy).toEqual(["has-live-attached-elements"]);
    expect(s.fadeSweep(D_FLOOR()).faded).toEqual([]);
  });

  test("a faded entity leaves preselection but keeps its id and its exit count", () => {
    const s = schemas();
    const id = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral once",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    s.fadeSweep(D_FLOOR());

    expect(s.slices()).toHaveLength(0);
    expect(s.aliasIndex().lookup("Ephemeral")).toEqual([]);
    // Guarantee 13: every kind names its exit. A kind with zero exits after the
    // window is a defect to investigate, not a base rate to accept.
    const row = s.lifecycle().find((r) => r.kind === "entity");
    expect(row).toEqual({ kind: "entity", created: 1, exited: 1, noExitsYet: false });
    expect(s.entity(id)?.archived).toBe(true);
  });

  test("a name mentioned again after its entity faded is a NEW birth, and churn is counted", () => {
    const s = schemas();
    const id = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral once",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    s.fadeSweep(D_FLOOR());

    const again = s.mention({
      name: "Ephemeral",
      kind: "entity",
      source: "Ephemeral, back again",
      chunkRef: "c9",
      day: D_FLOOR() + 1,
    });
    // The old entity died by physics; the mention is a fresh place for memories
    // to attach, not a resurrection of a row nothing can unarchive.
    expect(again.reason).toBe("born");
    expect(again.id).not.toBe(id);
    // ... and born-faded-born is a COUNTABLE fact, not an argument.
    const churn = s.events("schema.birth.after-fade");
    expect(churn).toHaveLength(1);
    expect(churn[0]?.data?.["priorId"]).toBe(id);
    // The dead entity keeps its id and its exit.
    expect(s.store.resolve(id)).toBe(id);
    expect(s.lifecycle().find((r) => r.kind === "entity")).toEqual({
      kind: "entity",
      created: 2,
      exited: 1,
      noExitsYet: false,
    });
  });
});

function D_FLOOR(): number {
  return PHYSICS.D_FLOOR_DAYS;
}

// ---------------------------------------------------------------------------
// Revision — pressure accumulates over lived days, every increment logged
// ---------------------------------------------------------------------------

describe("belief revision by pressure", () => {
  /** A person belief at sal 0.6, challenged by fresh sal-0.45 evidence. */
  function setup(): { s: Schemas; entityId: string; beliefId: string } {
    const s = schemas();
    const entityId = s.mention({
      name: "Ada",
      kind: "person",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = s.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    return { s, entityId, beliefId };
  }

  test("a FALLBACK-channel belief's claim is capped; a migrated one keeps the full floor (owner ruling 2026-08-29)", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai keeps shipping",
      chunkRef: "c1",
      day: 0,
    }).id as string;

    // The latent second door, closed: a belief placed on behalf of a sweep
    // carries the model's claim, and the ceiling cuts it at the element seam.
    const swept = s.addBelief({
      entityId,
      statement: "Bansai is the most important project that has ever existed.",
      day: 0,
      dimensions: { relevance: 0.3, emotional: 0.2, predictive: 0.3 },
      claimedSalience: 0.95,
      channel: "fallback",
    }).id as string;
    expect(s.store.row(swept)?.claimed).toBe(0.6);
    expect(s.store.row(swept)?.source).toBe("fallback");
    const lift = events.find((e) => e.event === "salience.lifted" && e.data?.["capped"] === true);
    expect({ claimed: lift?.data?.["claimed"], ceiling: lift?.data?.["ceiling"] }).toEqual({
      claimed: 0.95,
      ceiling: 0.6,
    });

    // Migrated is lived v1 state: full floor, honestly attributed.
    const migrated = s.addBelief({
      entityId,
      statement: "A v1 belief whose aggregate salience was earned by living it.",
      day: 0,
      dimensions: { relevance: 0.3, emotional: 0.2, predictive: 0.3 },
      claimedSalience: 0.9,
      channel: "migrated",
    }).id as string;
    expect(s.store.row(migrated)?.claimed).toBe(0.9);
    expect(s.store.row(migrated)?.source).toBe("migrated");

    // A caller that names NO channel records NOTHING — the persisted source is
    // never defaulted (the PR-2 review's blocker: a `?? "authored"` persistence
    // default stamped every migrated belief as authored-in-v2). The ceiling
    // arithmetic still defaults authored; only the CLAIM of authorship must be
    // explicit.
    const unstated = s.addBelief({
      entityId,
      statement: "Beliefs placed with no channel stay honestly unrecorded.",
      day: 0,
    }).id as string;
    expect(s.store.row(unstated)?.source).toBeNull();

    // Authorship, when actually stated, records.
    const authored = s.addBelief({
      entityId,
      statement: "Beliefs placed by the experiencer keep their testimony whole.",
      day: 0,
      channel: "authored",
    }).id as string;
    expect(s.store.row(authored)?.source).toBe("authored");
  });

  test("the belief row inherits the ENTITY's kind, so its inertia is the person's", () => {
    const { s, beliefId } = setup();
    expect(s.element(beliefId)?.kind).toBe("person");
    expect(s.store.physicsOf(beliefId).kind).toBe("person");
    expect(s.element(beliefId)?.role).toBe("belief");
  });

  test("pressure accumulates across lived days and crosses on the third", () => {
    const { s, entityId, beliefId } = setup();
    const verdicts: string[] = [];
    let last = null as ReturnType<Schemas["challengeBelief"]> | null;
    for (const day of [1, 2, 3]) {
      const cid = challenger(s.store, {
        day,
        salience: 0.45,
        body: "Ada asked for a live walkthrough instead",
      });
      last = s.challengeBelief({ updates: beliefId, challengerId: cid, day });
      verdicts.push(last.reason);
    }

    // Two holds, then the crossing: a belief about a person does not flip on one
    // odd act, and the daily force cap makes that a bound rather than a hope.
    expect(verdicts).toEqual(["below-bar", "below-bar", "revised"]);
    expect(last?.verdict).toBe("revise");
    expect(last?.pressureAfter).toBeGreaterThan(last?.bar as number);

    // The pressure field lives ON THE TARGET ROW — there is no second object.
    const successorId = last?.successorId as string;
    expect(successorId).not.toBeNull();
    // And the successor carries its channel: an accommodation successor is the
    // engine revising under pressure, its provenance the challenger that
    // carried the crossing (PR-2 review: SF1 was correct but unmechanized —
    // this is the row-level assertion behind the vocabulary's fifth member).
    expect(s.store.row(successorId)?.source).toBe("accommodation");
    expect(typeof s.store.row(successorId)?.origin_ref).toBe("string");
    expect(s.store.physicsOf(beliefId).pressure).toBeGreaterThan(0);
    expect(s.store.physicsOf(beliefId).lastChallengedDay).toBe(3);

    // Every increment is logged, with force, running pressure and the bar.
    const logged = s.events("revision.pressure");
    expect(logged).toHaveLength(3);
    expect(logged.map((e) => e.data?.["day"])).toEqual([1, 2, 3]);
    for (const e of logged) {
      expect(e.data?.["force"]).toBeGreaterThan(0);
      expect(e.data?.["bar"]).toBeGreaterThan(0);
    }

    // The old element is retained as superseded, with lineage, and resolvable.
    expect(s.store.read(beliefId).supersededBy).toBe(successorId);
    expect(s.store.resolve(beliefId)).toBe(successorId);
    expect(s.store.readVersion(beliefId, 1).body).toBe("Ada prefers async review");

    // ... and the successor stays attached to its schema.
    const successor = s.element(successorId);
    expect(successor?.entityId).toBe(entityId);
    expect(successor?.role).toBe("belief");
    expect(successor?.kind).toBe("person");
    expect(s.beliefs(entityId).map((b) => b.id)).toEqual([successorId]);
    expect(s.slices()[0]?.beliefs.map((b) => b.statement)).toEqual([
      "Ada asked for a live walkthrough instead",
    ]);
    // Every card element carries its ADDRESS — what an updates: declaration names.
    expect(s.slices()[0]?.beliefs[0]?.id).toBe(successorId);
  });

  test("one credited challenge per target per lived day — a second is refused by name", () => {
    const { s, beliefId } = setup();
    const a = challenger(s.store, { day: 1, salience: 0.45, body: "first" });
    const b = challenger(s.store, { day: 1, salience: 0.45, body: "second, same day" });
    const first = s.challengeBelief({ updates: beliefId, challengerId: a, day: 1 });
    const second = s.challengeBelief({ updates: beliefId, challengerId: b, day: 1 });

    expect(first.credited).toBe(true);
    expect(second.credited).toBe(false);
    expect(second.reason).toBe("already-challenged-today");
    expect(second.pressureAfter).toBe(second.pressureBefore);
    expect(s.events("revision.pressure")).toHaveLength(1);
  });

  test("a declaration naming a SUPERSEDED belief is retargeted, not dropped", () => {
    const { s, beliefId } = setup();
    for (const day of [1, 2, 3]) {
      const cid = challenger(s.store, { day, salience: 0.45, body: "walkthrough, please" });
      s.challengeBelief({ updates: beliefId, challengerId: cid, day });
    }
    const successorId = s.store.resolve(beliefId);
    expect(successorId).not.toBe(beliefId);

    // The old id keeps working: `store.resolve` is the one retarget site every
    // write path crosses (scar §2.2 — v1's dangling-ledger family).
    const late = challenger(s.store, { day: 4, salience: 0.45, body: "still wants the call" });
    const out = s.challengeBelief({ updates: beliefId, challengerId: late, day: 4 });
    expect(out.retargeted).toBe(true);
    expect(out.targetId).toBe(successorId);
    expect(out.credited).toBe(true);
    expect(s.store.physicsOf(successorId).pressure).toBeGreaterThan(0);
    expect(s.events("schema.revision.retargeted")).toHaveLength(1);
  });

  test("protected elements refuse every revision path, and accrue no pressure", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Ada",
      kind: "person",
      source: "Ada",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = s.addBelief({
      entityId,
      statement: "Ada's name is Ada",
      day: 0,
      protected: true,
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;

    const cid = challenger(s.store, { day: 1, salience: 1, body: "she goes by something else" });
    const out = s.challengeBelief({ updates: beliefId, challengerId: cid, day: 1 });
    expect(out.reason).toBe("protected-refuses-revision");
    expect(out.credited).toBe(false);
    expect(s.store.physicsOf(beliefId).pressure).toBe(0);
    expect(s.store.read(beliefId).supersededBy).toBeNull();
  });

  test("the seam's own refusals are distinct from physics' refusals", () => {
    const { s, beliefId } = setup();
    const cid = challenger(s.store, { day: 1, salience: 0.45, body: "evidence" });

    expect(s.challengeBelief({ updates: "", challengerId: cid, day: 1 }).reason).toBe(
      "no-declared-target",
    );
    expect(
      s.challengeBelief({ updates: "sch_deadbeefdead", challengerId: cid, day: 1 }).reason,
    ).toBe("target-unresolvable");
    expect(s.challengeBelief({ updates: cid, challengerId: cid, day: 1 }).reason).toBe(
      "target-not-a-belief",
    );
    expect(
      s.challengeBelief({ updates: beliefId, challengerId: "mem_deadbeefdead", day: 1 }).reason,
    ).toBe("challenger-unknown");
    expect(s.events("revision.pressure")).toHaveLength(0);
  });

  test("an archived-but-unsuperseded belief refuses with its own reason", () => {
    const { s, beliefId } = setup();
    s.store.archive(beliefId, "owner-retired-it");
    const cid = challenger(s.store, { day: 1, salience: 0.45, body: "evidence" });
    expect(s.challengeBelief({ updates: beliefId, challengerId: cid, day: 1 }).reason).toBe(
      "target-archived",
    );
  });

  test("the story view reads the lineage, the pressure, and the increments", () => {
    const { s, beliefId } = setup();
    for (const day of [1, 2, 3]) {
      const cid = challenger(s.store, { day, salience: 0.45, body: "walkthrough, please" });
      s.challengeBelief({ updates: beliefId, challengerId: cid, day });
    }
    const story = s.story(beliefId);
    expect(story.headId).toBe(s.store.resolve(beliefId));
    expect(story.increments).toHaveLength(3);
    expect(story.increments.map((i) => i.day)).toEqual([1, 2, 3]);
    expect(story.lineage.some((l) => l.reason === "revised-by-pressure")).toBe(true);
    expect(story.lineage.find((l) => l.reason === "revised-by-pressure")?.successorId).toBe(
      story.headId,
    );
  });
});

// ---------------------------------------------------------------------------
// Current state — a "now" fact flips on one clear correction (SEAMS item O)
// ---------------------------------------------------------------------------

describe("current-state replacement (owner ruling 2026-09-04)", () => {
  function setup(): { s: Schemas; entityId: string; stateId: string } {
    const s = schemas();
    const entityId = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai is the v1 instance",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const stateId = s.addCurrentState({
      entityId,
      statement: "Bansai is running as the live instance",
      day: 0,
      statedOn: "2026-08-01",
      dimensions: { relevance: 0.6, emotional: 0.6, predictive: 0.6 },
    }).id as string;
    return { s, entityId, stateId };
  }

  test("a declared update REPLACES a now-fact immediately — no bar, no pressure", () => {
    const { s, entityId, stateId } = setup();
    const cid = challenger(s.store, {
      day: 1,
      salience: 0.45,
      body: "Bansai is muted; counterparts is primary",
    });
    const out = s.replaceCurrentState({ updates: stateId, challengerId: cid, day: 1 });

    expect(out.reason).toBe("replaced");
    expect(out.successorId).not.toBeNull();
    // The correction did not have to climb anything: world state flips on one
    // clear correction (§4.3), so the pressure field never moved.
    expect(s.store.physicsOf(stateId).pressure).toBe(0);
    expect(s.store.physicsOf(stateId).lastChallengedDay).toBeNull();
    expect(s.events("revision.pressure")).toHaveLength(0);

    // Lineage, the same as any revision: the old row is retained, superseded,
    // and still resolvable (constitution 7).
    const successorId = out.successorId as string;
    expect(s.store.read(stateId).supersededBy).toBe(successorId);
    expect(s.store.resolve(stateId)).toBe(successorId);
    expect(s.store.readVersion(stateId, 1).body).toBe("Bansai is running as the live instance");
    expect(s.store.versions(stateId).map((v) => v.reason)).toEqual([TUNABLES.REPLACED_REASON]);

    // ... and the successor stays attached, as current state, on the same entity.
    expect(s.element(successorId)?.role).toBe("current-state");
    expect(s.element(successorId)?.entityId).toBe(entityId);
    expect(s.currentState(entityId).map((c) => c.id)).toEqual([successorId]);
    expect(s.slices()[0]?.currentState.map((c) => c.statement)).toEqual([
      "Bansai is muted; counterparts is primary",
    ]);
    // A replaced status is a status as of the day that replaced it.
    expect(s.element(successorId)?.statedOnDay).toBe(1);
    expect(s.store.row(successorId)?.source).toBe("accommodation");
  });

  test("the versions row says WHICH crossing ran — a replace is not a climbed bar", () => {
    const { s, stateId } = setup();
    const cid = challenger(s.store, { day: 1, salience: 0.45, body: "muted now" });
    s.replaceCurrentState({ updates: stateId, challengerId: cid, day: 1 });
    expect(TUNABLES.REPLACED_REASON).not.toBe(TUNABLES.REVISED_REASON);
    expect(s.store.versions(stateId)[0]?.reason).toBe("replaced-by-declaration");
  });

  test("a declaration against a SUPERSEDED now-fact is forwarded, never dangled", () => {
    const { s, stateId } = setup();
    const first = challenger(s.store, { day: 1, salience: 0.45, body: "muted now" });
    const head = s.replaceCurrentState({ updates: stateId, challengerId: first, day: 1 })
      .successorId as string;
    const second = challenger(s.store, { day: 2, salience: 0.45, body: "retired entirely" });
    // The declaration names the ORIGINAL id, a week out of date.
    const out = s.replaceCurrentState({ updates: stateId, challengerId: second, day: 2 });
    expect(out.retargeted).toBe(true);
    expect(out.targetId).toBe(head);
    expect(out.reason).toBe("replaced");
  });

  test("every refusal names its own ground, and none of them throws", () => {
    const { s, entityId, stateId } = setup();
    const cid = challenger(s.store, { day: 1, salience: 0.45, body: "evidence" });
    const beliefId = s.addBelief({ entityId, statement: "it is a memory system", day: 0 })
      .id as string;

    expect(s.replaceCurrentState({ updates: "", challengerId: cid, day: 1 }).reason).toBe(
      "no-declared-target",
    );
    expect(
      s.replaceCurrentState({ updates: "sch_deadbeefdead", challengerId: cid, day: 1 }).reason,
    ).toBe("target-unresolvable");
    // A belief is not a now-fact: it takes pressure, and this path says so.
    expect(s.replaceCurrentState({ updates: beliefId, challengerId: cid, day: 1 }).reason).toBe(
      "target-not-current-state",
    );
    expect(s.replaceCurrentState({ updates: entityId, challengerId: cid, day: 1 }).reason).toBe(
      "target-not-current-state",
    );
    expect(
      s.replaceCurrentState({ updates: stateId, challengerId: "mem_deadbeefdead", day: 1 }).reason,
    ).toBe("challenger-unknown");

    // Nothing moved on any of them.
    expect(s.store.read(stateId).supersededBy).toBeNull();
    expect(s.events("schema.state.replace.refused")).toHaveLength(5);
  });

  test("a PROTECTED now-fact refuses the replace path too (§5 G11)", () => {
    const { s, stateId } = setup();
    s.store.updatePhysics(stateId, { protected: true });
    const cid = challenger(s.store, { day: 1, salience: 1, body: "it changed" });
    expect(s.replaceCurrentState({ updates: stateId, challengerId: cid, day: 1 }).reason).toBe(
      "protected-refuses-revision",
    );
    expect(s.store.read(stateId).supersededBy).toBeNull();
  });

  test("an archived-but-unsuperseded now-fact refuses with its own reason", () => {
    const { s, stateId } = setup();
    s.store.archive(stateId, "owner-retired-it");
    const cid = challenger(s.store, { day: 1, salience: 0.45, body: "it changed" });
    expect(s.replaceCurrentState({ updates: stateId, challengerId: cid, day: 1 }).reason).toBe(
      "target-archived",
    );
  });
});

// ---------------------------------------------------------------------------
// The placement rule — the ~72 KB lesson
// ---------------------------------------------------------------------------

describe("status lives on the entity, never in identity", () => {
  function withSelf(): { s: Schemas; selfId: string } {
    const store = Store.open({ dir });
    open.push(store);
    const selfId = store.put({
      type: "schema",
      kind: "self",
      title: "self",
      body: "# self\n\nthe identity core\n",
      meta: { role: "entity", name: "self", aliases: [] },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    return { s: Schemas.open({ store }), selfId };
  }

  test("current state on the identity schema is refused BY NAME, with a home named", () => {
    const { s, selfId } = withSelf();
    const out = s.addCurrentState({
      entityId: selfId,
      statement: "the fix-queue batch is 2 of 4 done",
      day: 3,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("status-on-identity-refused");
    expect(out.id).toBeNull();
    expect(out.belongsOn).toEqual([...BIRTH_KINDS]);
    expect(s.currentState(selfId)).toHaveLength(0);
    expect(s.events("schema.placement.refused")[0]?.data?.["reason"]).toBe(
      "status-on-identity-refused",
    );
  });

  test("the same status lands on the project entity, timestamped", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts is 2 of 4 through the fix queue",
      chunkRef: "c1",
      day: 3,
    }).id as string;
    const out = s.addCurrentState({
      entityId,
      statement: "2 of 4 through the fix queue",
      day: 3,
      statedOn: "2026-08-25",
    });
    expect(out.ok).toBe(true);
    expect(out.reason).toBe("placed");

    const row = s.currentState(entityId)[0];
    expect(row?.statement).toBe("2 of 4 through the fix queue");
    expect(row?.statedOn).toBe("2026-08-25");
    expect(row?.statedOnDay).toBe(3);
    // Entity inertia is deliberately the loosest of the slow kinds: world-state
    // should flip on one clear correction (§4.3, chosen out loud).
    expect(row?.kind).toBe("entity");
    // Rendered verbatim to the author: a paraphrase cannot be contradicted.
    expect(s.slices()[0]?.currentState.map((c) => c.statement)).toEqual(["2 of 4 through the fix queue"]);
  });

  test("placement refusals name their reason, one per failure mode", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    expect(s.addCurrentState({ entityId: "sch_nope", statement: "x", day: 0 }).reason).toBe(
      "entity-unknown",
    );
    expect(s.addCurrentState({ entityId, statement: "   ", day: 0 }).reason).toBe(
      "statement-empty",
    );
    s.store.archive(entityId, "owner-retired-it");
    expect(s.addCurrentState({ entityId, statement: "x", day: 0 }).reason).toBe("entity-archived");
    expect(s.addBelief({ entityId, statement: "x", day: 0 }).reason).toBe("entity-archived");
  });

  test("beliefs on the identity core are NOT refused — only status is", () => {
    const { s, selfId } = withSelf();
    const out = s.addBelief({ entityId: selfId, statement: "I prefer evidence to ceremony", day: 1 });
    expect(out.ok).toBe(true);
    expect(s.beliefs(selfId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The alias index — one whole-word definition, shared
// ---------------------------------------------------------------------------

describe("the alias index", () => {
  test("lookup and encode's occursAsWholeWord agree, term for term", () => {
    const s = schemas();
    const id = s.mention({
      name: "Bansai",
      kind: "entity",
      source: "Bansai, aka bans, and the self of the thing",
      chunkRef: "c1",
      day: 0,
      aliases: ["bans"],
    }).id as string;
    const index = s.aliasIndex();

    const texts = [
      "Bansai shipped today",
      "the bansai-site deploy is green",
      "bans is the short name",
      "bansai",
      "BANSAI IN CAPS",
      "unbansai is not a word we use",
      "banshee sang",
      "no names here at all",
      "he said 'bans' out loud",
    ];

    // The agreement itself: for every registered term, this module's index and
    // encode's matcher must return the same answer on the same text. There is
    // ONE definition (SEAMS §7); this test is what proves the import is real.
    for (const text of texts) {
      for (const term of ["Bansai", "bans"]) {
        const viaIndex = index.matchesIn(text).some((h) => h.term === term);
        expect(viaIndex).toBe(occursAsWholeWord(text, term));
      }
      const idsFromIndex = [...new Set(index.matchesIn(text).map((h) => h.id))];
      const expected = ["Bansai", "bans"].some((t) => occursAsWholeWord(text, t)) ? [id] : [];
      expect(idsFromIndex).toEqual(expected);
    }
  });

  test("the module defines no second whole-word rule — it imports the one", () => {
    const sources = readdirSync(SCHEMAS_SRC)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(SCHEMAS_SRC, f), "utf8"));
    const joined = sources.join("\n");
    expect(joined).toContain('from "../encode/words.js"');
    // No lookaround boundary regex, no `\b`, no local word-character class: the
    // three shapes a re-implementation takes.
    expect(joined).not.toContain("\\b");
    expect(joined).not.toContain("(?<!");
    expect(joined).not.toContain("(?!");
    expect(joined).not.toMatch(/WORD_CHAR\s*=/);
    expect(joined).not.toMatch(/function\s+occursAsWholeWord/);
  });

  test("a handle pointing at two entities is reported ambiguous, both halves live", () => {
    const s = schemas();
    // Two entities the index can see, reached through explicit alias ops.
    const a = s.mention({
      name: "Atlas",
      kind: "entity",
      source: "Atlas the service",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const b = s.mention({
      name: "Atlas Team",
      kind: "person",
      source: "Atlas Team, the people",
      chunkRef: "c2",
      day: 0,
    });
    // Near collision: the index refuses to hold two things under one handle by
    // accident, so ambiguity has to be constructed deliberately.
    expect(b.reason).toBe("collision-near");

    const index = s.aliasIndex();
    index.register("sch_synthetic0001", "Atlas", []);
    expect(index.lookup("atlas").sort()).toEqual(["sch_synthetic0001", a].sort());
    expect(index.ambiguous()).toEqual(["atlas"]);
    expect([...(s.aliasMap().get("atlas") ?? [])].length).toBe(2);
  });

  test("aliases change only through the explicit alias operation", () => {
    const s = schemas();
    const id = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    expect(s.entity(id)?.aliases).toEqual([]);

    const out = s.addAliases(id, ["cparts", "unsaid"], "we call Counterparts cparts", 1);
    expect(out.ok).toBe(true);
    expect(out.kept).toEqual(["cparts"]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["alias-not-verbatim-in-source"]);
    expect(s.aliasIndex().lookup("cparts")).toEqual([id]);
    // Persisted in the prose, and archived-on-overwrite by the store.
    expect(s.store.versions(id).some((v) => v.reason === "alias-op")).toBe(true);
    expect(s.addAliases("sch_nope", ["x"], "x", 1).reason).toBe("entity-unknown");
  });

  test("slices feed encode's preselection unchanged, and the lexical channel finds them", () => {
    const s = schemas();
    const id = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, aka cparts, is the successor",
      chunkRef: "c1",
      day: 0,
      aliases: ["cparts"],
    }).id as string;
    s.addBelief({ entityId: id, statement: "it embeds into any host", day: 0 });
    s.addCurrentState({ entityId: id, statement: "schemas module landed", day: 0 });

    // The slice type is encode's, plus an elision count (INTERFACE-GAPS §4).
    const pre = preselectSchemas({
      chunkRef: "c9",
      span: "spent the morning on Counterparts",
      schemas: s.slices(),
    });
    expect(pre.lexicalIds).toEqual([id]);
    expect(pre.blind).toBe(false);

    // Beliefs and current state render VERBATIM — the surface contradiction
    // detection runs on (§8 G7) — and nothing was elided (§5 G8).
    const rendered = renderSchemaContext(pre, s.slices());
    expect(rendered).toContain("it embeds into any host");
    expect(rendered).toContain("schemas module landed");
    expect(s.slices()[0]?.elided).toBe(0);

    // An alias in the span reaches the same schema, by the same rule.
    const viaAlias = preselectSchemas({
      chunkRef: "c10",
      span: "cparts is the successor",
      schemas: s.slices(),
    });
    expect(viaAlias.lexicalIds).toEqual([id]);
  });

  test("the index survives a reopen — it is rebuilt from canonical prose", () => {
    const first = schemas();
    const id = first.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts, aka cparts",
      chunkRef: "c1",
      day: 0,
      aliases: ["cparts"],
    }).id as string;
    first.addBelief({ entityId: id, statement: "it embeds", day: 0 });
    first.store.close();
    open.length = 0;

    const reopened = schemas();
    expect(reopened.entity(id)?.name).toBe("Counterparts");
    expect(reopened.aliasIndex().lookup("cparts")).toEqual([id]);
    expect(reopened.beliefs(id).map((b) => b.statement)).toEqual(["it embeds"]);
  });
});

// ---------------------------------------------------------------------------
// Module-level properties
// ---------------------------------------------------------------------------

describe("module properties", () => {
  test("no operation edits a belief: the public surface is total and enumerated", () => {
    const actual = Object.getOwnPropertyNames(Schemas.prototype)
      .filter((n) => n !== "constructor")
      .filter((n) => !n.startsWith("_"))
      .filter((n) => {
        const d = Object.getOwnPropertyDescriptor(Schemas.prototype, n);
        return typeof d?.value === "function";
      });
    // Private fields are `private` in TypeScript only, so the declared surface
    // is the contract: a new `editBelief` cannot appear without editing it.
    const declared = new Set<string>(PUBLIC_SURFACE);
    const undeclared = actual.filter((n) => !declared.has(n) && !PRIVATE_HELPERS.has(n));
    expect(undeclared).toEqual([]);
    for (const name of PUBLIC_SURFACE) expect(actual).toContain(name);
    // The verb that must not exist, spelled out.
    for (const forbidden of ["editBelief", "setBelief", "rewriteBelief", "promote", "setBand"]) {
      expect(actual).not.toContain(forbidden);
    }
  });

  test("this module never promotes and never sets a band — a source scan says so", () => {
    const joined = readdirSync(SCHEMAS_SRC)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(SCHEMAS_SRC, f), "utf8"))
      .join("\n");
    expect(joined).not.toContain("setBand(");
    expect(joined).not.toContain("promotionEligibility");
    expect(joined).not.toMatch(/\bpromote\(/);
    expect(joined).not.toMatch(/promotedIdentity:\s*true/);
  });

  test("the roles and birth kinds are closed vocabularies", () => {
    expect([...SCHEMA_ROLES]).toEqual(["entity", "belief", "current-state"]);
    expect([...BIRTH_KINDS]).toEqual(["person", "entity", "skill", "place"]);
    expect(isBirthKind("fact")).toBe(false);
    expect(isBirthKind("person")).toBe(true);
  });

  test("lifecycle counts created versus exited, per kind", () => {
    const s = schemas();
    s.mention({ name: "Ada", kind: "person", source: "Ada", chunkRef: "c1", day: 0 });
    s.mention({ name: "Bansai", kind: "entity", source: "Bansai", chunkRef: "c2", day: 0 });
    const rows = s.lifecycle();
    expect(rows.map((r) => r.kind).sort()).toEqual(["entity", "person"]);
    for (const r of rows) {
      expect(r.created).toBe(1);
      expect(r.exited).toBe(0);
      // Zero exits is a question, not a clean bill of health (scar §2.17).
      expect(r.noExitsYet).toBe(true);
    }
  });

  test("observer mode refuses the write before anything is staged", () => {
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Store.open({ dir }).close();
    const store = Store.open({ dir, observer: true });
    open.push(store);
    const s = Schemas.open({ store });
    expect(() =>
      s.mention({ name: "Bansai", kind: "entity", source: "Bansai", chunkRef: "c1", day: 0 }),
    ).toThrow();
    // Nothing was staged, and on this floor there is nothing that COULD be:
    // the write is one INSERT inside the transaction the stance check refused
    // before it opened. The store directory holds the two boxes and no more.
    expect(readdirSync(dir).filter((n) => !n.startsWith("counterparts.sqlite-")).sort()).toEqual([
      "cache",
      "counterparts.sqlite",
    ]);
    expect(store.list({ type: "schema" })).toEqual([]);
  });
});

/** Methods TypeScript marks private; they are on the prototype at runtime. */
const PRIVATE_HELPERS = new Set([
  "load",
  // SEAMS item K: story() reads the DURABLE increments out of box 2's events
  // table and unions this session's ring on top. A read helper, no new operation.
  "storyIncrements",
  "remember",
  "emit",
  "fadedNamed",
  "nearCollisions",
  "reMention",
  "birth",
  "requireEntity",
  "mintElement",
  "supersedeBelief",
  // SEAMS item O: the ONE supersede flow both element paths cross (lineage,
  // index registration, the SEAMS-E retarget, the crossing record). Shared so
  // `replaceCurrentState` cannot quietly grow a second, thinner version of it.
  "supersedeElement",
  "liveElementIds",
  // The chased-row predicate `load` and `entity` share, so "the owner removed
  // this" cannot drift into two readings. `element` gates on the same blanked
  // pointer inline and borrows the deny-list refusal from `physicsOf`.
  "removed",
]);

describe("statement bodies cross the secrets gate at the source (PR-6 review SF1)", () => {
  test("a credential in a belief statement is redacted on disk — not just at the prompt and embedder edges", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Deploy",
      kind: "entity",
      source: "Deploy pipeline notes",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = s.addBelief({
      entityId,
      statement: "The Deploy key is AIzaSyD-1234567890abcdefghijklmnopqrstuv and it broke the build.",
      day: 0,
    }).id as string;
    // The STORED belief carries the redaction mark, never the credential —
    // the store held it raw before this (name and aliases were gated; the
    // statement body was not).
    const body = s.store.readProse(beliefId).body;
    expect(body).toContain("[REDACTED:google-api-key]");
    expect(body).not.toContain("AIzaSyD-1234567890abcdefghijklmnopqrstuv");
    // And the slice the sweep would show carries the redacted form too.
    expect(s.slices()[0]?.beliefs[0]?.statement).toContain("[REDACTED:");
  });
});

describe("the index build is a look at the ADDRESS, not at the memory", () => {
  test("opening Schemas over an archived element spends no archived-read telemetry", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Counterparts",
      kind: "entity",
      source: "Counterparts is the successor",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = s.addBelief({
      entityId,
      statement: "it embeds into any host",
      day: 0,
    }).id as string;
    s.store.archive(beliefId, "owner-retired-it");
    s.store.close();
    open.length = 0;

    const seen: StoreEvent[] = [];
    const store = Store.open({ dir, onEvent: (e) => seen.push(e) });
    open.push(store);
    // The whole scan, archived row included — and `element` on top of it, which
    // is the other read that goes round `Store.read` for the same reason.
    const reopened = Schemas.open({ store });
    expect(reopened.element(beliefId)?.statement).toBe("it embeds into any host");
    expect(seen.filter((e) => e.name === "store.archived.read")).toEqual([]);

    // NOT vacuous: the row really is archived, and the read that DOES count as a
    // look at archived content still says so.
    expect(store.row(beliefId)?.archived).toBe(1);
    expect(store.read(beliefId).archived).toBe(true);
    expect(seen.filter((e) => e.name === "store.archived.read").map((e) => e.ref)).toEqual([
      beliefId,
    ]);
  });

  test("a DARK-stage removal does not take the next open down", () => {
    const s = schemas();
    const entityId = s.mention({
      name: "Ada",
      kind: "entity",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const beliefId = s.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
    }).id as string;
    // `dark` marks the id and leaves the row and the file until the chase. The
    // scan walks every schema row at every open, so a refusal here would be the
    // next session failing to start, not one memory hidden — the deny-list is
    // answered where the OWNER asks (`read`), and that is still true below.
    s.store.appendRemovalRecord({
      memoryId: beliefId,
      stage: "dark",
      actor: "owner",
      reason: "test",
    });
    // Hidden from every render IN THIS SESSION too, without a reopen: a live
    // `Schemas` is older than the removal and must not keep serving it. Before
    // 2026-09-18 `slices()` threw `REMOVED` here — a model path, from the
    // deny-list check inside `physicsOf`.
    expect(s.element(beliefId)).toBeUndefined();
    expect(s.beliefs(entityId)).toEqual([]);
    expect(s.slices()[0]?.beliefs).toEqual([]);
    expect(s.store.deniedIds()).toContain(beliefId);
    s.store.close();
    open.length = 0;

    const store = Store.open({ dir });
    open.push(store);
    let reopened: Schemas | undefined;
    expect(() => {
      reopened = Schemas.open({ store });
    }).not.toThrow();
    expect(reopened?.element(beliefId)).toBeUndefined();
    expect(reopened?.beliefs(entityId)).toEqual([]);
    // The entity itself is untouched — one belief was removed, not the person.
    expect(reopened?.entity(entityId)?.name).toBe("Ada");
    // And "removed" still reads as removed, by name, to anyone asking by id.
    expect(() => store.read(beliefId)).toThrow();
  });
});

/**
 * THE CRASH THIS CLOSES (2026-09-18, found by the F3 adversarial review).
 *
 * `MEMORY_BEARING` permits `schema` targets, so an entity or a belief is a legal
 * `counterparts remove`. The chase KEEPS the row and blanks `prose_path`
 * (`store/owner-op-seam.ts`), `store.list({type:"schema"})` still returns it,
 * and `Schemas.load` had no guard — so `readProseFile("")` threw
 * `PROSE_FILE_MISSING` out of `Schemas.open`, out of `Counterpart.open`. The
 * hook entry point catches that, writes one stderr line and EXITS 0: every
 * session afterwards had no wake, no recall and no capture, silently. That is
 * the failure mode a memory system may not have.
 *
 * These run the REAL command end to end. A hand-appended stage would not have
 * reproduced it — the blanked pointer is the chase's doing, not the mark's.
 */
describe("removing a schema element is survivable (2026-09-18)", () => {
  /** Ada, and two things believed about her. */
  function person(s: Schemas): { entityId: string; first: string; second: string } {
    const entityId = s.mention({
      name: "Ada",
      kind: "entity",
      source: "Ada prefers async review",
      chunkRef: "c1",
      day: 0,
    }).id as string;
    const first = s.addBelief({
      entityId,
      statement: "Ada prefers async review",
      day: 0,
    }).id as string;
    const second = s.addBelief({
      entityId,
      statement: "Ada reads faster when someone talks her through it",
      day: 0,
    }).id as string;
    return { entityId, first, second };
  }

  function removeIt(targetId: string): void {
    const s = Store.open({ dir });
    ownerRemoval(s, { targetId, actor: "owner", reason: "the owner asked", requestedAt: 0 });
    s.close();
  }

  /** The whole brain, opened and closed around one assertion block — the thing
   *  that used to throw. Closed in a `finally` so a failure leaks no handle. */
  function woken(fn: (c: Counterpart) => void): void {
    const c = Counterpart.open({ dir, owner: true });
    try {
      fn(c);
    } finally {
      c.close();
    }
  }

  test("a removed BELIEF: the next session still opens, and the belief is gone from it", () => {
    const s = schemas();
    const ids = person(s);
    s.store.close();
    open.length = 0;

    removeIt(ids.first);

    // The row survives the chase as a TOMBSTONE — body and content hash both
    // blanked, which is the shape that used to throw. Asserted so this test
    // cannot pass because removal changed.
    const store = Store.open({ dir });
    open.push(store);
    expect(store.row(ids.first)).toBeDefined();
    expect(store.row(ids.first)?.body).toBe("");
    expect(store.row(ids.first)?.content_hash).toBe("");

    // THE REGRESSION: the whole brain opens.
    woken((c) => {
      expect(c.schemas.entity(ids.entityId)?.name).toBe("Ada");
      // Absent from every rendering, by id and in the round.
      expect(c.schemas.element(ids.first)).toBeUndefined();
      expect(c.schemas.beliefs(ids.entityId).map((b) => b.id)).toEqual([ids.second]);
      expect(c.schemas.slices()[0]?.beliefs.map((b) => b.id)).toEqual([ids.second]);
      const said = JSON.stringify(c.schemas.slices());
      expect(said).not.toContain("prefers async review");
      expect(said).toContain("talks her through it");
      // The surviving belief is untouched; this is a removal, not a purge.
      expect(c.schemas.element(ids.second)?.statement).toBe(
        "Ada reads faster when someone talks her through it",
      );
    });
  });

  test("a removed ENTITY: its beliefs go out of every rendering with it, and say so", () => {
    const s = schemas();
    const ids = person(s);
    s.store.close();
    open.length = 0;

    removeIt(ids.entityId);

    woken((c) => {
      // The person is gone from the index, so nothing hangs off her any more:
      // every rendering path starts at an entity, and hers is not there.
      expect(c.schemas.entity(ids.entityId)).toBeUndefined();
      expect(c.schemas.entities()).toEqual([]);
      expect(c.schemas.slices()).toEqual([]);
      expect(c.schemas.aliasIndex().lookup("ada")).toEqual([]);

      // DECIDED, and worth being plain about: the two BELIEF rows are NOT
      // removed — removal does not cascade to what hangs off its target (the
      // plan's contamination scan REPORTS similar rows, it does not chase
      // them). They are orphaned: gone from every path that starts at an
      // entity, and ordinary rows to every path that does not. That is the
      // honest state, not a claim that they were destroyed. Whether the
      // ceremony should chase them is `cli/removal.ts`'s question and the
      // owner's call. The assertion carries the word, because this assertion is
      // now the only thing between "decided" and "regression".
      const decided = "DECIDED: an orphan survives its entity's removal";
      expect(`${decided} — ${c.store.read(ids.first).doc.body.includes("prefers async review")}`)
        .toBe(`${decided} — true`);
      expect(c.schemas.element(ids.first)?.statement).toContain("prefers async review");
      expect(c.schemas.element(ids.first)?.entityId).toBe(ids.entityId);
      // The owner can still find them: they are exactly the elements whose
      // entity no longer resolves.
      expect(c.schemas.entity(c.schemas.element(ids.first)?.entityId ?? "")).toBeUndefined();
    });
  });

  test("a removal that names an ordinary memory changes nothing about the index", () => {
    const s = schemas();
    const ids = person(s);
    const plain = s.store.put({
      type: "memory",
      kind: "fact",
      body: "The garage door opener needs a new battery soon.",
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    const before = JSON.stringify(s.slices());
    s.store.close();
    open.length = 0;

    removeIt(plain);

    woken((c) => {
      expect(JSON.stringify(c.schemas.slices())).toBe(before);
      expect(c.schemas.beliefs(ids.entityId).map((b) => b.id)).toEqual(
        [ids.first, ids.second].sort(),
      );
      expect(c.schemas.aliasIndex().lookup("ada")).toEqual([ids.entityId]);
    });
  });

  test("`loadSkips` tells a removal from a corruption, because only one is explained", () => {
    const s = schemas();
    const ids = person(s);
    s.store.close();
    open.length = 0;
    removeIt(ids.first);

    const store = Store.open({ dir });
    open.push(store);
    const after = Schemas.open({ store });
    // One skip, and the store can account for it: the owner removed it.
    expect(after.loadSkips()).toEqual({ removed: 1, unaccounted: [] });
    expect(store.deniedIds()).toContain(ids.first);
    // Non-vacuous: an untouched store skips nothing at all.
    const clean = makeStore({ prefix: "counterparts-schemas-clean-" });
    try {
      expect(Schemas.open({ store: clean.store }).loadSkips()).toEqual({ removed: 0, unaccounted: [] });
    } finally {
      clean.cleanup();
    }
  });

  test("a blank pointer with NO removal record is skipped too, and counted as unexplained", () => {
    const s = schemas();
    const ids = person(s);
    s.store.close();
    open.length = 0;
    // The shape a half-written repair or a disk event leaves: the row is
    // tombstoned and NOTHING says who tombstoned it. There is no store API for
    // this, and there should not be — the chase is the only thing that blanks a
    // row on purpose — so the test writes it the way the damage would.
    const db = new Database(join(dir, "counterparts.sqlite"));
    db.run("UPDATE memories SET body = '', content_hash = '' WHERE id = ?", [ids.second]);
    db.close();

    const store = Store.open({ dir });
    open.push(store);
    const after = Schemas.open({ store });
    expect(after.loadSkips()).toEqual({ removed: 0, unaccounted: [ids.second] });
    expect(store.deniedIds()).toEqual([]);
    // Skipped, not fatal, and not pretending it was a removal.
    expect(after.element(ids.second)).toBeUndefined();
    expect(after.beliefs(ids.entityId).map((b) => b.id)).toEqual([ids.first]);
  });

  test("a walk asks the deny-list ONCE, however many entities and however long the list", () => {
    const s = schemas();
    // SEVERAL entities, because one would make this pass either way: the old
    // `entities()` asked per entity, so the count is the whole assertion.
    const names = ["Ada", "Bea", "Cleo", "Dara", "Esme"];
    for (const [i, name] of names.entries()) {
      s.mention({ name, kind: "entity", source: `${name} is here`, chunkRef: `c${i}`, day: 0 });
    }
    // 200 removals of ordinary memories: none of them is a schema row, so the
    // answer must not change — and the walk must not get slower per removal.
    // Asking per entity measured, at 300 entities, 10.0 ms against an empty
    // deny-list and 172.9 ms against 1,000; one query for the walk is 6.1 and
    // 6.7 ms. A deny-list only ever grows.
    for (let i = 0; i < 200; i++) {
      const id = s.store.put({
        type: "memory",
        kind: "fact",
        body: `an ordinary memory number ${i}`,
        physics: { birthDay: 0, lastUsedDay: 0 },
      });
      s.store.appendRemovalRecord({ memoryId: id, stage: "dark", actor: "owner", reason: "t" });
    }
    expect(s.store.deniedIds()).toHaveLength(200);

    // Counted rather than timed: a wall-clock assertion on a walk is a flaky
    // test, and "how many times it asks" is the thing that actually changed.
    let queries = 0;
    const real = s.store.deniedIds.bind(s.store);
    (s.store as unknown as { deniedIds: () => string[] }).deniedIds = () => {
      queries += 1;
      return real();
    };
    const seen = s.entities();
    expect(queries).toBe(1);
    expect(seen.map((e) => e.name).sort()).toEqual([...names].sort());
  });
});
