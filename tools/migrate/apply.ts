/**
 * `tools/migrate/apply.ts` — the writer. It decides nothing.
 *
 * Every judgement was made in `plan.ts`; this file writes the plan down through
 * v2's PUBLIC API and counts what actually moved. It holds no v1 knowledge, it
 * re-gates nothing (the plan's text already came back from the battery, and
 * gating twice would let a bug in one copy hide behind the other), and it reaches
 * into no module's internals: `Store.put/archive/link/setProspective/setMeta`,
 * `Self.ensureIdentityCore`, `Schemas.mention/addBelief/addCurrentState`. That is
 * the whole surface.
 *
 * TWO STRUCTURAL NOTES, both of them consequences of being a consumer:
 *
 * 1. **The store is opened twice.** `Self.ensureIdentityCore` mints a row that
 *    `schemas/` indexes, but a LIVE `Schemas` instance does not learn about a row
 *    minted behind its back — it builds its index in `load()` at construction. So
 *    phase A sets the clock and mints the identity core, and phase B reopens, at
 *    which point `Schemas.load()` sees the core and beliefs can be added to it.
 *    Filed in `INTERFACE-GAPS.md` §1; a consumer must not reach into the index to
 *    fix it.
 *
 * 2. **Idempotence is checked before every write, never after.** A re-run must
 *    perform no write at all (§5 G9) — not "an overwrite that happens to be
 *    equal". Documents are checked by their content-derived id, elements by their
 *    post-gate statement against the entity's rows (archived included — an
 *    archived element is still work this tool did), edges and prospective rows by
 *    reading them back first.
 */
import { Counterpart } from "../../src/core/counterpart.js";
import type { PutInput } from "../../src/core/store/index.js";
import type { MigrationPlan, PlannedDoc, PlannedElement, Tally } from "./plan.js";

export class MigrateApplyError extends Error {
  readonly code: string;
  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "MigrateApplyError";
    this.code = code;
  }
}

const ELEMENT_KEY_SEP = "\u0000";

export function applyPlan(plan: MigrationPlan, targetDir: string): void {
  if (plan.tunables.LEDGER_TO_PRESSURE) {
    // A tunable that is ON and silently does nothing is worse than one that is
    // off: it reads as a mapping that happened. It refuses by name instead.
    throw new MigrateApplyError("LEDGER_TO_PRESSURE_NOT_WIRED", {
      why: "the pressure mapping waits on the parallel run (CONTRACT §6)",
    });
  }
  const tally = plan.tally;

  // ── phase A: the clock, then the identity core ───────────────────────────
  const core = plan.entities.find((e) => e.identityCore);
  {
    const cp = Counterpart.open({ dir: targetDir });
    try {
      // THE CLOCK FIRST, BEFORE ANY PUT (§6): imported `birthDay` values are
      // lived-day integers on v1's clock, and `strength(m, d)` reads the
      // difference — land them against a day-zero store and every memory would
      // decay from the future.
      setMetaIfChanged(cp, "livedDay", String(plan.livedDay));
      if (plan.lastActiveDate.length > 0) {
        setMetaIfChanged(cp, "lastActiveDate", plan.lastActiveDate);
      }
      if (core !== undefined) {
        cp.self.ensureIdentityCore({ name: core.name, aliases: core.aliases });
      }
    } finally {
      cp.close();
    }
  }

  // ── phase B: everything else ─────────────────────────────────────────────
  const cp = Counterpart.open({ dir: targetDir });
  try {
    const idMap = new Map<string, string>();

    for (const doc of plan.docs) {
      writeDoc(cp, doc, tally);
      if (doc.v1Id !== null) idMap.set(doc.v1Id, doc.v2Id);
    }

    const seen = existingElementKeys(cp);

    for (const entity of plan.entities) {
      let entityId: string | null;
      if (entity.identityCore) {
        // Idempotent by construction: a second identity core is a category error
        // no evidence could justify, so this returns the existing one.
        const outcome = cp.self.ensureIdentityCore({ name: entity.name, aliases: entity.aliases });
        entityId = outcome.id;
        if (outcome.created) tally.writes.entitiesBorn += 1;
        else tally.writes.existing += 1;
      } else {
        const already = findEntityByName(cp, entity.name);
        if (already !== null) {
          entityId = already;
          tally.writes.existing += 1;
        } else {
          // `source: name` — a name occurs as a whole word in itself, which is
          // the honest reading of "this mention names this entity" when the
          // mention IS the schema's own frontmatter.
          const outcome = cp.schemas.mention({
            name: entity.name,
            kind: entity.kind,
            source: entity.name,
            chunkRef: `migrate:${entity.sourceRef}`,
            aliases: entity.aliases,
            day: plan.livedDay,
          });
          entityId = outcome.id;
          if (outcome.born) tally.writes.entitiesBorn += 1;
          if (!outcome.ok) {
            tally.writes.refused += 1;
            tally.counts.entities.imported -= 1;
            tally.counts.entities.skipped += 1;
            tally.skip("entity", entity.sourceRef, `schemas:${outcome.reason}`);
          }
        }
      }
      if (entityId === null) {
        for (const el of entity.elements) {
          tally.counts.elements.imported -= 1;
          tally.counts.elements.skipped += 1;
          tally.skip("element", el.sourceRef, "entity-never-landed");
        }
        continue;
      }
      idMap.set(entity.v1Id, entityId);
      for (const el of entity.elements) {
        const id = writeElement(cp, entityId, el, plan.livedDay, seen, tally);
        if (id !== null && el.v1Id !== null) idMap.set(el.v1Id, id);
      }
    }

    for (const edge of plan.edges) {
      const src = idMap.get(edge.v1Src);
      const dst = idMap.get(edge.v1Dst);
      if (src === undefined || dst === undefined) {
        tally.counts.edges.imported -= 1;
        tally.counts.edges.skipped += 1;
        tally.skip("edge", `${edge.v1Src}->${edge.v1Dst}`, "edge-endpoint-unmapped");
        continue;
      }
      if (cp.store.edgesFrom(src).some((row) => row.dst === dst && row.weight === edge.weight)) {
        tally.writes.existing += 1;
        continue;
      }
      try {
        cp.store.link({ src, dst, weight: edge.weight, day: edge.day });
        tally.writes.edges += 1;
      } catch (err) {
        // Box 2 is foreign-keyed: an endpoint that is not a memory row is a
        // refusal, and a refusal is data, not a crash.
        tally.counts.edges.imported -= 1;
        tally.counts.edges.skipped += 1;
        tally.writes.refused += 1;
        tally.skip("edge", `${edge.v1Src}->${edge.v1Dst}`, `store:${codeOf(err)}`);
      }
    }

    for (const entry of plan.prospective) {
      const memoryId = idMap.get(entry.v1TraceId);
      if (memoryId === undefined) {
        tally.counts.prospective.imported -= 1;
        tally.counts.prospective.skipped += 1;
        tally.skip("prospective", entry.v1TraceId, "prospective-trace-unmapped");
        continue;
      }
      const existing = cp.store
        .prospectiveFor(memoryId)
        .find((row) => row.window_key === entry.windowKey);
      if (existing !== undefined && existing.state === entry.state && existing.fires === entry.fires) {
        tally.writes.existing += 1;
        continue;
      }
      try {
        cp.store.setProspective({
          memoryId,
          windowKey: entry.windowKey,
          eventDate: entry.eventDate,
          precision: entry.precision,
          state: entry.state,
          fires: entry.fires,
          // The last-fired LIVED day is not recoverable from a calendar stamp;
          // null is the honest reading, and the drop is counted (§6).
          lastFiredDay: null,
        });
        tally.writes.prospective += 1;
      } catch (err) {
        tally.counts.prospective.imported -= 1;
        tally.counts.prospective.skipped += 1;
        tally.writes.refused += 1;
        tally.skip("prospective", entry.v1TraceId, `store:${codeOf(err)}`);
      }
    }
  } finally {
    cp.close();
  }
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

function writeDoc(cp: Counterpart, doc: PlannedDoc, tally: Tally): void {
  if (cp.store.has(doc.v2Id)) {
    tally.writes.existing += 1;
    return;
  }
  const put: PutInput = {
    id: doc.v2Id,
    type: doc.type,
    kind: doc.kind,
    body: doc.body,
    meta: doc.meta,
    band: doc.band,
    salience: doc.salience,
    physics: {
      birthDay: doc.physics.birthDay,
      uses: doc.physics.uses,
      lastUsedDay: doc.physics.lastUsedDay,
      reinforcedDays: doc.physics.reinforcedDays,
      promotedIdentity: doc.physics.promotedIdentity,
      protected: doc.physics.protected,
    },
    // The mint-source doctrine (owner ruling 2026-08-29): a cutover row is
    // "migrated" — lived v1 state whose salience keeps its full floor (the v1
    // aggregate WAS lived testimony), attributed honestly and traceable to its
    // v1 address. Never "authored": nobody authored it in v2.
    source: "migrated",
    origin: { ref: doc.v1Id ?? doc.sourceRef },
  };
  if (doc.title !== undefined) put.title = doc.title;
  if (doc.happenedOn !== undefined) put.happenedOn = doc.happenedOn;
  if (doc.learnedOn !== undefined) put.learnedOn = doc.learnedOn;

  try {
    cp.store.put(put);
    tally.writes.created += 1;
  } catch (err) {
    tally.writes.refused += 1;
    const bucket = doc.type === "episode" ? tally.counts.episodes : tally.counts.traces;
    bucket.imported -= 1;
    bucket.skipped += 1;
    tally.skip(doc.type, doc.sourceRef, `store:${codeOf(err)}`);
    return;
  }
  if (doc.archiveReason !== undefined) {
    // Archive is a state, not a deletion (§4.2 G3): the id stays resolvable and
    // the row keeps everything it had.
    cp.store.archive(doc.v2Id, doc.archiveReason);
    tally.writes.archived += 1;
  }
}

// ---------------------------------------------------------------------------
// One element
// ---------------------------------------------------------------------------

function writeElement(
  cp: Counterpart,
  entityId: string,
  el: PlannedElement,
  day: number,
  seen: Set<string>,
  tally: Tally,
): string | null {
  const key = `${entityId}${ELEMENT_KEY_SEP}${el.role}${ELEMENT_KEY_SEP}${el.statement}`;
  if (seen.has(key)) {
    tally.writes.existing += 1;
    return null;
  }
  let id: string | null;
  let reason: string;
  if (el.role === "belief") {
    const outcome = cp.schemas.addBelief({
      entityId,
      statement: el.statement,
      day,
      protected: el.protected,
      claimedSalience: el.claimedSalience,
      // Honest attribution (the PR-2 review's blocker): lived v1 state, full
      // salience floor, and NEVER "authored" — nobody authored it in v2.
      channel: "migrated",
    });
    id = outcome.id;
    reason = outcome.reason;
  } else {
    const outcome = cp.schemas.addCurrentState({
      entityId,
      statement: el.statement,
      day,
      ...(el.statedOn === undefined || el.statedOn.length === 0 ? {} : { statedOn: el.statedOn }),
      claimedSalience: el.claimedSalience,
      channel: "migrated",
    });
    id = outcome.id;
    reason = outcome.reason;
  }
  if (id === null) {
    tally.writes.refused += 1;
    tally.counts.elements.imported -= 1;
    tally.counts.elements.skipped += 1;
    tally.skip("element", el.sourceRef, `schemas:${reason}`);
    return null;
  }
  seen.add(key);
  tally.writes.elementsAdded += 1;
  if (el.archiveReason !== undefined) {
    cp.store.archive(id, el.archiveReason);
    tally.writes.archived += 1;
  }
  return id;
}

/**
 * Every element already in the target, ARCHIVED ONES INCLUDED. `Schemas.beliefs`
 * lists only live rows, and a second run must find the superseded belief it
 * archived on the first — or it would add it again and archive it again, forever.
 */
function existingElementKeys(cp: Counterpart): Set<string> {
  const out = new Set<string>();
  for (const id of cp.store.list({ type: "schema" })) {
    let doc;
    try {
      doc = cp.store.readProse(id);
    } catch {
      continue;
    }
    const role = doc.meta["role"];
    const entityId = doc.meta["entityId"];
    if (typeof role !== "string" || typeof entityId !== "string") continue;
    out.add(`${entityId}${ELEMENT_KEY_SEP}${role}${ELEMENT_KEY_SEP}${doc.body}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function findEntityByName(cp: Counterpart, name: string): string | null {
  const want = name.trim().toLowerCase();
  for (const e of cp.schemas.entities({ includeArchived: true })) {
    if (e.name.trim().toLowerCase() === want) return e.id;
  }
  return null;
}

/** A re-run must not rewrite meta it already wrote — "no write" means no write. */
function setMetaIfChanged(cp: Counterpart, key: string, value: string): void {
  if (cp.store.getMeta(key) === value) return;
  cp.store.setMeta(key, value);
}

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "UNKNOWN";
}
