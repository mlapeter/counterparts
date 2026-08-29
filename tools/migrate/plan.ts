/**
 * `tools/migrate/plan.ts` — the mapping, as a pure in-memory plan.
 *
 * EVERYTHING THAT DECIDES ANYTHING HAPPENS HERE, and none of it touches a store.
 * That is what makes the dry run real (CONTRACT §5 G12): planning is where the
 * gate runs, where the physics is translated, where a skip gets its reason and
 * where an approximation gets counted — so `--apply` is nothing but "write the
 * plan down", and a dry run reports exactly what an apply would do.
 *
 * The approximations this file applies are the ones §6 tabulates. Each is read
 * off `tunables.ts` by name, and each application is counted, because a
 * migration is a pile of approximations and the only honest way to ship one is
 * for every single one to be visible in the report.
 */
import { clamp01 } from "../../src/core/physics/index.js";
import { hashText } from "../../src/core/store/prose.js";
import type { Band, Kind, Salience } from "../../src/core/types.js";
import { gateBody, scanName } from "./gate.js";
import { withTunables } from "./tunables.js";
import type { MigrateTunables } from "./tunables.js";
import type {
  ApproximationRecord,
  GateSummary,
  KindCount,
  MigrationReport,
  SkipRecord,
  V1Episode,
  V1Schema,
  V1Store,
  V1Trace,
  WriteSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** One prose document to write, addressed by a content-derived id (§5 G9). */
export interface PlannedDoc {
  v2Id: string;
  /** `<relPath>#<v1 id>` — the import key, and the report's address. */
  sourceRef: string;
  /** The v1 id this document IS, for edge/prospective resolution. */
  v1Id: string | null;
  type: "memory" | "episode";
  kind: Kind;
  body: string;
  title?: string;
  happenedOn?: string;
  learnedOn?: string;
  meta: Record<string, unknown>;
  band: Band;
  salience: Salience;
  physics: {
    birthDay: number;
    uses: number;
    lastUsedDay: number;
    reinforcedDays: number;
    promotedIdentity: boolean;
    protected: boolean;
  };
  /** When set, the document is archived immediately after it is written. */
  archiveReason?: string;
}

export interface PlannedElement {
  role: "belief" | "current-state";
  /** Post-gate statement text. The idempotence key for elements (§5 G9). */
  statement: string;
  sourceRef: string;
  v1Id: string | null;
  protected: boolean;
  claimedSalience: number | null;
  statedOn?: string;
  archiveReason?: string;
}

export interface PlannedEntity {
  sourceRef: string;
  v1Id: string;
  name: string;
  aliases: string[];
  kind: Kind;
  /** The v1 `self` schema: it becomes the identity core, not a birth. */
  identityCore: boolean;
  elements: PlannedElement[];
}

export interface PlannedEdge {
  v1Src: string;
  v1Dst: string;
  weight: number;
  day: number;
}

export interface PlannedProspective {
  v1TraceId: string;
  windowKey: string;
  eventDate: string;
  precision: "day" | "month" | "year";
  state: "armed" | "fired" | "suppressed";
  fires: number;
}

export interface MigrationPlan {
  livedDay: number;
  lastActiveDate: string;
  docs: PlannedDoc[];
  entities: PlannedEntity[];
  edges: PlannedEdge[];
  prospective: PlannedProspective[];
  tally: Tally;
  tunables: MigrateTunables;
}

// ---------------------------------------------------------------------------
// The tally — the report, accumulated
// ---------------------------------------------------------------------------

export class Tally {
  readonly counts: MigrationReport["counts"] = {
    traces: zero(),
    episodes: zero(),
    entities: zero(),
    elements: zero(),
    elementsAsMemories: zero(),
    edges: zero(),
    prospective: zero(),
    ledger: zero(),
  };
  readonly gate: GateSummary = {
    bodiesScanned: 0,
    bodiesRedacted: 0,
    bodiesRefused: 0,
    firesByFamily: {},
    refusalsByReason: {},
    namesDropped: 0,
  };
  readonly writes: WriteSummary = {
    created: 0,
    existing: 0,
    archived: 0,
    entitiesBorn: 0,
    elementsAdded: 0,
    edges: 0,
    prospective: 0,
    refused: 0,
  };
  readonly skipped: SkipRecord[] = [];
  readonly dropped: Record<string, number> = {};
  readonly edgeTypes: Record<string, number> = {};
  private readonly approx = new Map<string, ApproximationRecord>();

  skip(what: string, ref: string, reason: string): void {
    // A skip with no reason is the failure this report exists to prevent, so the
    // empty case is filled in loudly rather than allowed through (§5 G10).
    this.skipped.push({ what, ref, reason: reason.length > 0 ? reason : "unspecified-DEFECT" });
  }

  drop(field: string, n = 1): void {
    this.dropped[field] = (this.dropped[field] ?? 0) + n;
  }

  approximate(name: string, note: string, n = 1): void {
    const row = this.approx.get(name) ?? { name, applied: 0, note };
    row.applied += n;
    this.approx.set(name, row);
  }

  approximations(): ApproximationRecord[] {
    return [...this.approx.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

function zero(): KindCount {
  return { read: 0, imported: 0, skipped: 0 };
}

// ---------------------------------------------------------------------------
// Ids — content-derived, so a second run recomputes the same address (§5 G9)
// ---------------------------------------------------------------------------

export function docId(type: "memory" | "episode", sourceRef: string): string {
  return `${type === "memory" ? "mem" : "epi"}_${hashText(sourceRef)}`;
}

// ---------------------------------------------------------------------------
// Physics translation (§6)
// ---------------------------------------------------------------------------

/** Stated precision, never rounded (behavioral-spec §4.2's three dates). */
export function precisionOf(date: string): "day" | "month" | "year" {
  if (/^\d{4}$/.test(date)) return "year";
  if (/^\d{4}-\d{2}$/.test(date)) return "month";
  return "day";
}

/**
 * v1 measured ONE salience; v2 measures four dimensions. The missing ones are
 * not invented: relevance takes v1's aggregate, emotional takes the typed
 * emotion's intensity (or 0 — an absent emotion is null, never neutral),
 * predictive is 0 because v1 never measured prediction, and novelty is NULL
 * because v1 never computed prediction error and a blind encoding says so
 * (scar §2.9). The aggregate then rides as the author's CLAIMED FLOOR, so
 * `sal(m)` reproduces v1's number exactly.
 */
export function salienceOf(
  aggregate: number,
  emotionIntensity: number | null,
  t: MigrateTunables,
): Salience {
  return {
    novelty: null,
    relevance: clamp01(aggregate),
    emotional: emotionIntensity === null ? 0 : clamp01(emotionIntensity),
    predictive: 0,
    claimed: t.SALIENCE_AS_CLAIMED_FLOOR ? clamp01(aggregate) : null,
  };
}

export function bandOf(gradient: number, t: MigrateTunables): Band {
  if (gradient >= t.IDENTITY_GRADIENT_CUT) return "identity";
  if (gradient >= t.SEMANTIC_GRADIENT_CUT) return "semantic";
  return "episodic";
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanOptions {
  tunables?: Partial<MigrateTunables>;
}

export function planMigration(v1: V1Store, opts: PlanOptions = {}): MigrationPlan {
  const t = withTunables(opts.tunables ?? {});
  const tally = new Tally();
  const docs: PlannedDoc[] = [];
  const entities: PlannedEntity[] = [];

  for (const trace of v1.traces) {
    tally.counts.traces.read += 1;
    const doc = planTrace(trace, v1, t, tally);
    if (doc === null) tally.counts.traces.skipped += 1;
    else {
      docs.push(doc);
      tally.counts.traces.imported += 1;
    }
  }

  for (const ep of v1.episodes) {
    tally.counts.episodes.read += 1;
    const doc = planEpisode(ep, v1, t, tally);
    if (doc === null) tally.counts.episodes.skipped += 1;
    else {
      docs.push(doc);
      tally.counts.episodes.imported += 1;
    }
  }

  for (const schema of v1.schemas) {
    tally.counts.entities.read += 1;
    planSchema(schema, v1, t, tally, entities, docs);
  }

  // Edge endpoints are v1 ids; the writer resolves them against what actually
  // landed. Planning only checks that the endpoint is something we intend to
  // import at all — a dangling endpoint is a named skip, never a silent drop,
  // and never an insert with a broken foreign key.
  const planned = new Set<string>();
  for (const d of docs) if (d.v1Id !== null) planned.add(d.v1Id);
  for (const e of entities) {
    planned.add(e.v1Id);
    for (const el of e.elements) if (el.v1Id !== null) planned.add(el.v1Id);
  }

  const edges: PlannedEdge[] = [];
  for (const edge of v1.edges) {
    tally.counts.edges.read += 1;
    tally.edgeTypes[edge.type] = (tally.edgeTypes[edge.type] ?? 0) + 1;
    tally.drop("edge.type");
    tally.drop("edge.valence");
    if (!planned.has(edge.src) || !planned.has(edge.dst)) {
      tally.counts.edges.skipped += 1;
      tally.skip("edge", `${edge.src}->${edge.dst}`, "edge-endpoint-unmapped");
      continue;
    }
    edges.push({ v1Src: edge.src, v1Dst: edge.dst, weight: edge.weight, day: v1.meta.activeDay });
    tally.counts.edges.imported += 1;
  }

  const prospective: PlannedProspective[] = [];
  const traceById = new Map(v1.traces.map((tr) => [tr.id, tr] as const));
  for (const entry of v1.prospective) {
    tally.counts.prospective.read += 1;
    // The last-fired LIVED DAY cannot be recovered from a calendar stamp (§6):
    // the count is the brake that matters, and the day is dropped out loud.
    tally.drop("prospective.lastFiredDay");
    const trace = traceById.get(entry.traceId);
    if (trace === undefined || !planned.has(entry.traceId)) {
      tally.counts.prospective.skipped += 1;
      tally.skip("prospective", entry.traceId, "prospective-trace-unmapped");
      continue;
    }
    const eventDate = trace.eventDate ?? entry.windowKey;
    prospective.push({
      v1TraceId: entry.traceId,
      windowKey: entry.windowKey,
      eventDate,
      precision: precisionOf(eventDate),
      state: entry.referenced ? "suppressed" : entry.firedDays.length > 0 ? "fired" : "armed",
      fires: entry.firedDays.length,
    });
    tally.counts.prospective.imported += 1;
  }

  for (const entry of v1.ledger) {
    tally.counts.ledger.read += 1;
    tally.counts.ledger.skipped += 1;
    // Deliberately not durable in v2 (§6): v2 fires a revision at
    // `pressure >= iota x strength(target)`, and v1's cumulativeScore was
    // accumulated by different arithmetic against different strengths.
    tally.skip(
      "ledger",
      entry.id,
      entry.status === "open" ? "ledger-open-not-mapped-to-pressure" : "ledger-closed",
    );
  }

  return {
    livedDay: v1.meta.activeDay,
    lastActiveDate: v1.meta.lastSessionDate,
    docs,
    entities,
    edges,
    prospective,
    tally,
    tunables: t,
  };
}

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

function planTrace(
  trace: V1Trace,
  v1: V1Store,
  t: MigrateTunables,
  tally: Tally,
): PlannedDoc | null {
  const sourceRef = `${trace.relPath}#${trace.id}`;
  const gated = runGate(
    { text: trace.body, kind: trace.kind, ref: sourceRef, ...(trace.title === undefined ? {} : { title: trace.title }) },
    tally,
  );
  if (!gated.ok) {
    tally.skip("trace", sourceRef, `gate:${gated.blockedBy.join("+")}`);
    return null;
  }
  if (gated.titleDropped) tally.skip("trace-title", sourceRef, "title-carried-credential");

  const meta: Record<string, unknown> = {
    // THE FIELD BUILD-STATUS GAP 5 NAMES: `recall/activate.ts#isConfidential`
    // reads exactly this key, and `recall/gate.ts` withholds on it. Without this
    // line 16 sensitive traces would lose their protection at cutover.
    confidentiality: trace.confidentiality,
    scope: trace.scope,
    sessionRef: trace.sessionRef,
    migratedFrom: sourceRef,
  };
  const aliases = keepNames(trace.aliases ?? [], tally);
  if (aliases.length > 0) meta["aliases"] = aliases;
  const handles = keepNames(trace.handles ?? [], tally);
  if (handles.length > 0) meta["handles"] = handles;
  if (trace.emotion !== null) {
    meta["feeling"] = trace.emotion.core;
    meta["feelingSubject"] = trace.emotion.subject;
    // v2's durable feeling is {type, subject}: the shade has no home, and the
    // intensity is spent on the emotional dimension instead of being invented.
    tally.drop("emotion.shade");
  }
  if (trace.taskState === true) meta["taskState"] = true;
  if (trace.derivedFrom !== undefined) meta["derivedFrom"] = [...trace.derivedFrom];
  if (Object.keys(trace.extra).length > 0) meta["v1Extra"] = { ...trace.extra };
  if (trace.lastDecayedDay !== undefined) tally.drop("trace.lastDecayedDay");

  const uses = usesOf(trace, t, tally);
  const doc: PlannedDoc = {
    v2Id: docId("memory", sourceRef),
    sourceRef,
    v1Id: trace.id,
    type: "memory",
    kind: trace.kind,
    body: gated.text,
    meta,
    band: bandOf(trace.gradient, t),
    salience: salienceOf(trace.salience, trace.emotion?.intensity ?? null, t),
    physics: {
      birthDay: trace.createdActiveDay,
      uses,
      lastUsedDay: lastUsedDayOf(trace, v1, uses, tally),
      reinforcedDays: uses,
      // Identity ink is for LIVE traces only: a memory v1 itself retired
      // (archived or merged away) cannot arrive PERMANENT. NOTES §6's
      // histogram measured the live set; the archived set carries its own
      // high-gradient rows — the 2026-08-29 pre-cutover dry run found an
      // archived/superseded self trace at 0.95 that would otherwise have
      // taken the twentieth promotion. Exemptions are counted below.
      promotedIdentity:
        trace.gradient >= t.IDENTITY_GRADIENT_CUT &&
        trace.mergedInto === undefined &&
        trace.archived !== true,
      protected: false,
    },
  };
  if (
    trace.gradient >= t.IDENTITY_GRADIENT_CUT &&
    (trace.mergedInto !== undefined || trace.archived === true)
  ) {
    tally.approximate(
      "IDENTITY_CUT_ARCHIVED_EXEMPT",
      "gradient qualified but the trace is archived/merged in v1 — retired memories do not arrive permanent",
    );
  }
  if (t.SALIENCE_AS_CLAIMED_FLOOR) {
    tally.approximate(
      "SALIENCE_AS_CLAIMED_FLOOR",
      "v1's single aggregate salience carried as v2's claimed floor, so sal(m) reproduces it exactly",
    );
  }
  if (doc.physics.promotedIdentity) {
    tally.approximate(
      "IDENTITY_GRADIENT_CUT",
      `gradient >= ${t.IDENTITY_GRADIENT_CUT} arrives already promoted-identity — the one place migration mints permanent ink`,
    );
  }
  if (gated.title !== undefined) doc.title = gated.title;
  if (trace.eventDate !== undefined) doc.happenedOn = trace.eventDate;
  if (trace.created !== undefined) doc.learnedOn = trace.created;
  if (trace.mergedInto !== undefined) {
    // A NAMED GAP, not a mapping (§6): v1's merges are many-to-one, v2's
    // supersession is a one-to-one forwarding chain, and faking a chain would
    // invent lineage. The pointer survives; `resolve()` will not follow it.
    meta["mergedInto"] = trace.mergedInto;
    doc.archiveReason = `merged-into:${trace.mergedInto}`;
    tally.approximate(
      "MERGE_AS_ARCHIVE",
      "v1 merge source archived with its pointer in meta; v2 resolve() does not forward it",
    );
  } else if (trace.archived === true) {
    doc.archiveReason = trace.archiveReason ?? "archived-in-v1";
  }
  return doc;
}

function usesOf(trace: V1Trace, t: MigrateTunables, tally: Tally): number {
  const occurrences = trace.occurrences ?? 1;
  if (!t.BIRTH_IS_NOT_A_USE) return Math.max(0, occurrences);
  if (occurrences > 1) {
    tally.approximate(
      "BIRTH_IS_NOT_A_USE",
      "v1 occurrences count the birth; v2 uses do not — uses = occurrences - 1",
    );
  }
  return Math.max(0, occurrences - 1);
}

/**
 * There is no calendar-to-lived-day map: lived days skip the days not lived. We
 * have exactly ONE anchor — `meta.activeDay` <-> `meta.lastSessionDate` — so a
 * stamp equal to the anchor converts exactly and everything else falls back to
 * the birth day. The fallback is deliberately the CONSERVATIVE direction: it can
 * understate recency, and therefore strength, but never overstate it.
 */
function lastUsedDayOf(trace: V1Trace, v1: V1Store, uses: number, tally: Tally): number {
  if (uses === 0 || trace.lastReinforcedDay === undefined) return trace.createdActiveDay;
  if (
    v1.meta.lastSessionDate.length > 0 &&
    trace.lastReinforcedDay === v1.meta.lastSessionDate
  ) {
    return Math.max(trace.createdActiveDay, v1.meta.activeDay);
  }
  tally.approximate(
    "LAST_USED_FALLBACK",
    "a reinforcement stamp off the single clock anchor falls back to birthDay — conservative, never overstating recency",
  );
  return trace.createdActiveDay;
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

function planEpisode(
  ep: V1Episode,
  v1: V1Store,
  t: MigrateTunables,
  tally: Tally,
): PlannedDoc | null {
  const sourceRef = ep.relPath;
  const gated = runGate({ text: ep.body, kind: "self", ref: sourceRef }, tally);
  if (!gated.ok) {
    tally.skip("episode", sourceRef, `gate:${gated.blockedBy.join("+")}`);
    return null;
  }
  // A v1 episode carries no lived day of its own — the file name carries a
  // calendar date and nothing maps that back. It is born on the cutover day,
  // counted, rather than assigned a lived day nobody computed.
  tally.approximate(
    "EPISODE_BIRTH_IS_CUTOVER_DAY",
    "v1 episodes carry no lived day; they are born on the cutover day",
  );
  const doc: PlannedDoc = {
    v2Id: docId("episode", sourceRef),
    sourceRef,
    v1Id: null,
    type: "episode",
    kind: "self",
    body: gated.text,
    meta: { migratedFrom: sourceRef },
    band: "episodic",
    salience: salienceOf(ep.salience ?? 0, null, t),
    physics: {
      birthDay: v1.meta.activeDay,
      uses: 0,
      lastUsedDay: v1.meta.activeDay,
      reinforcedDays: 0,
      promotedIdentity: false,
      protected: false,
    },
  };
  const happened = ep.when ?? ep.date;
  if (happened !== null && happened !== undefined) doc.happenedOn = happened;
  if (ep.date !== null) doc.learnedOn = ep.date;
  return doc;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const BIRTH_KINDS: readonly Kind[] = ["person", "entity", "skill", "place"];

function planSchema(
  schema: V1Schema,
  v1: V1Store,
  t: MigrateTunables,
  tally: Tally,
  entities: PlannedEntity[],
  docs: PlannedDoc[],
): void {
  const day = v1.meta.activeDay;
  const isSelf = schema.kind === "self";

  if (!isSelf && !BIRTH_KINDS.includes(schema.kind)) {
    // `fact` is not a birth kind in v2 — a fact is a memory, not a thing
    // memories attach to. Its statements still travel; they land as memories.
    tally.counts.entities.skipped += 1;
    tally.skip("entity", `${schema.relPath}#${schema.id}`, "schema-kind-has-no-entity-home");
    for (const item of [...schema.core, ...schema.beliefs, ...schema.protected]) {
      planElementAsMemory(schema, item.id, item.statement, schema.kind, day, tally, docs, {});
    }
    return;
  }

  const name = schema.name.trim();
  if (name.length === 0 || !scanName(name).keep) {
    tally.counts.entities.skipped += 1;
    tally.skip("entity", `${schema.relPath}#${schema.id}`, name.length === 0 ? "entity-name-empty" : "entity-name-carried-credential");
    return;
  }

  const entity: PlannedEntity = {
    sourceRef: `${schema.relPath}#${schema.id}`,
    v1Id: schema.id,
    name,
    aliases: keepNames(schema.aliases, tally),
    kind: schema.kind,
    identityCore: isSelf,
    elements: [],
  };
  tally.approximate(
    "ENTITY_BIRTH_IS_CUTOVER_DAY",
    "v1 schemas carry no birth day; entities are born on the cutover day",
  );

  const element = (
    role: "belief" | "current-state",
    v1Id: string | null,
    statement: string,
    extra: Partial<PlannedElement> = {},
  ): void => {
    const ref = `${schema.relPath}#${v1Id ?? hashText(statement)}`;
    const gated = runGate({ text: statement, kind: schema.kind, ref }, tally);
    tally.counts.elements.read += 1;
    if (!gated.ok) {
      tally.counts.elements.skipped += 1;
      tally.skip("element", ref, `gate:${gated.blockedBy.join("+")}`);
      return;
    }
    entity.elements.push({
      role,
      // TRIMMED, deliberately: `Schemas.addBelief` trims before it mints, so an
      // untrimmed plan statement would never match the stored body and the
      // second run would add a duplicate instead of finding its own work (G9).
      statement: gated.text.trim(),
      sourceRef: ref,
      v1Id,
      protected: false,
      claimedSalience: null,
      ...extra,
    });
    tally.counts.elements.imported += 1;
  };

  for (const item of schema.core) element("belief", item.id, item.statement);
  for (const item of schema.relationships) {
    // v1's `entity` label on a relationship has no metadata channel through
    // `Schemas.addBelief`, and this tool does not reach past the public API to
    // make one. The statement travels; the label is dropped, out loud.
    if (item.entity !== undefined) tally.drop("relationship.entity");
    element("belief", item.id, item.statement);
  }
  for (const item of schema.beliefs) {
    // v1 provenance is a list of session refs; v2's `groundedIn` wants memory
    // ids. Different things with the same shape — dropped rather than mistyped.
    if (item.provenance.length > 0) tally.drop("belief.provenance");
    tally.drop("belief.confidence");
    element(
      "belief",
      item.id,
      item.statement,
      item.status === "superseded" ? { archiveReason: "superseded-in-v1" } : {},
    );
  }
  for (const item of schema.protected) {
    element("belief", item.id, item.statement, {
      protected: true,
      claimedSalience: item.salience,
    });
  }
  if (isSelf) {
    for (const item of schema.selfIndex) {
      // `verbatim: true` is v1's author-only permanent-ink flag ("never
      // recompress this"), set by the owner's CLI and by no model-facing path.
      // It arrives as protection, which is v2's spelling of permanent ink.
      element("belief", null, item.statement, {
        protected: item.verbatim === true,
        claimedSalience: item.warmth,
      });
      tally.drop("selfIndex.pointers");
      tally.drop("selfIndex.shelfQuery");
    }
  }

  for (const item of schema.currentState) {
    if (isSelf) {
      // `Schemas.addCurrentState` refuses status on the identity schema by name
      // — the ~72 KB lesson mechanized at that seam. The refusal is right; losing
      // the owner's prose is not, so it lands as an ordinary self-kind memory
      // and the report counts the route.
      planElementAsMemory(schema, item.id, item.statement, schema.kind, day, tally, docs, {
        statedOn: item.timestamp,
        route: "status-on-identity-refused",
      });
      continue;
    }
    element("current-state", item.id, item.statement, { statedOn: item.timestamp });
  }

  for (const item of schema.threads) {
    // An open loop is an ordinary memory with a flag, and `unresolved` is what
    // puts it in the briefing's threads lane.
    planElementAsMemory(schema, item.id, item.statement, schema.kind, day, tally, docs, {
      unresolved: true,
      openedOn: item.opened,
      route: "thread-as-unresolved-memory",
    });
  }
  for (const item of schema.superseded) {
    planElementAsMemory(schema, null, item.old, schema.kind, day, tally, docs, {
      archiveReason: `superseded-in-v1:${item.cycleRef}`,
      route: "lineage-record",
    });
  }
  for (const item of schema.archivedCore) {
    planElementAsMemory(schema, item.elementId, item.statement, schema.kind, day, tally, docs, {
      archiveReason: `archived-core-in-v1:${item.reason}`,
      route: "lineage-record",
    });
  }

  entities.push(entity);
  tally.counts.entities.imported += 1;
}

/** A schema element with no live element home: it lands as prose, never nowhere. */
function planElementAsMemory(
  schema: V1Schema,
  v1Id: string | null,
  statement: string,
  kind: Kind,
  day: number,
  tally: Tally,
  docs: PlannedDoc[],
  opts: {
    unresolved?: boolean;
    openedOn?: string;
    statedOn?: string;
    archiveReason?: string;
    route?: string;
  },
): void {
  tally.counts.elementsAsMemories.read += 1;
  const sourceRef = `${schema.relPath}#${v1Id ?? hashText(statement)}`;
  const gated = runGate({ text: statement, kind, ref: sourceRef }, tally);
  if (!gated.ok) {
    tally.counts.elementsAsMemories.skipped += 1;
    tally.skip("element-as-memory", sourceRef, `gate:${gated.blockedBy.join("+")}`);
    return;
  }
  const meta: Record<string, unknown> = { migratedFrom: sourceRef, v1Schema: schema.id };
  if (opts.unresolved === true) meta["unresolved"] = true;
  if (opts.openedOn !== undefined) meta["openedOn"] = opts.openedOn;
  if (opts.statedOn !== undefined) meta["statedOn"] = opts.statedOn;
  if (opts.route !== undefined) meta["migrationRoute"] = opts.route;

  const doc: PlannedDoc = {
    v2Id: docId("memory", sourceRef),
    sourceRef,
    v1Id,
    type: "memory",
    kind,
    body: gated.text,
    meta,
    band: "episodic",
    salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
    physics: {
      birthDay: day,
      uses: 0,
      lastUsedDay: day,
      reinforcedDays: 0,
      promotedIdentity: false,
      protected: false,
    },
  };
  if (opts.archiveReason !== undefined) doc.archiveReason = opts.archiveReason;
  docs.push(doc);
  tally.counts.elementsAsMemories.imported += 1;
  if (opts.route !== undefined) {
    tally.approximate(`ROUTE:${opts.route}`, "a v1 element with no live v2 element home landed as prose");
  }
}

// ---------------------------------------------------------------------------
// Gate bookkeeping — families and counts, never content (§5 G10)
// ---------------------------------------------------------------------------

function runGate(req: Parameters<typeof gateBody>[0], tally: Tally): ReturnType<typeof gateBody> {
  const outcome = gateBody(req);
  tally.gate.bodiesScanned += 1;
  for (const f of outcome.findings) {
    tally.gate.firesByFamily[f.family] = (tally.gate.firesByFamily[f.family] ?? 0) + f.count;
  }
  if (outcome.redacted) tally.gate.bodiesRedacted += 1;
  if (outcome.titleDropped) tally.gate.namesDropped += 1;
  if (!outcome.ok) {
    tally.gate.bodiesRefused += 1;
    for (const reason of outcome.blockedBy) {
      tally.gate.refusalsByReason[reason] = (tally.gate.refusalsByReason[reason] ?? 0) + 1;
    }
  }
  return outcome;
}

function keepNames(names: readonly string[], tally: Tally): string[] {
  const kept: string[] = [];
  for (const name of names) {
    if (scanName(name).keep) kept.push(name);
    else tally.gate.namesDropped += 1;
  }
  return kept;
}
