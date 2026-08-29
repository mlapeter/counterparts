/**
 * `schemas/` — semantic memory.
 *
 * The entities experience organizes itself around, and the beliefs held about
 * them. Brain analog: schema formation — repeated episodes abstract into a
 * structure new experience is compared against, which is what makes prediction
 * error possible.
 *
 * FOUR PROPERTIES HOLD ACROSS THE WHOLE MODULE, each enforced rather than
 * asserted (test/schemas.test.ts proves every one):
 *
 * 1. **No operation edits a belief.** There is no such verb — `PUBLIC_SURFACE`
 *    enumerates every method, and a test asserts the class has exactly those.
 *    A belief's text changes only as the result of `physics.applyChallenge`
 *    arithmetic on a DECLARED `updates:`, and the prior text is retained by
 *    `store.supersede` (§5 G1, and the accommodation guardrail preserved by
 *    construction).
 * 2. **Birth is by mention, death is by decay.** A newly-named entity becomes a
 *    stub immediately — an explicit, logged creation event, no gate and no
 *    proposal queue (owner decision 2026-08-25). A stub that never accumulates
 *    fades by ordinary physics; no model, on any path, can kill an entity
 *    (§5 G7).
 * 3. **Status lives on the entity, never in identity.** The ~72 KB lesson,
 *    mechanized at this seam as a named refusal (§3, `status-on-identity-refused`).
 * 4. **This module never promotes.** Promotion is physics'/sleep's counted
 *    crossing; here `band` is READ and nothing else. There is no `setBand` call
 *    and no promotion path in this directory, and a source scan says so.
 *
 * Ambiguities the contract left open are recorded in NOTES.md; what this module
 * needed from a neighbour and could not have is in INTERFACE-GAPS.md.
 */

import {
  applyChallenge,
  band as bandOfPhysics,
  clampSalienceAtSeam,
  pruneVerdict,
  revisionBar,
  strength as strengthOf,
  successorSeed,
  supersedeRecord,
  TUNABLES as PHYSICS_TUNABLES,
} from "../physics/index.js";
import type { MemoryPhysics } from "../physics/index.js";
import { gateAliases } from "../encode/aliases.js";
import { containsSecret, redactSecrets } from "../encode/secrets.js";
import { occursAsWholeWord } from "../encode/words.js";
import { Store, hashText, readProseFile, today } from "../store/index.js";
import type { MemoryRow, PutInput } from "../store/index.js";
import type { Band, Kind, Salience } from "../types.js";
import { AliasIndex, collision, handleKey } from "./aliases.js";
import { TUNABLES } from "./tunables.js";
import {
  BIRTH_KINDS,
  isBirthKind,
} from "./types.js";
import type {
  BeliefInput,
  BeliefOutcome,
  BeliefStory,
  BirthKind,
  BirthOutcome,
  BirthReason,
  ChallengeInput,
  CurrentStateInput,
  DimensionsInput,
  ElementView,
  EntityView,
  FadeReason,
  FadeReport,
  FadeVerdict,
  LifecycleRow,
  LineageStep,
  MentionInput,
  PlacementOutcome,
  PlacementReason,
  PressureIncrement,
  RevisionOutcome,
  RevisionReason,
  SchemaEvent,
  SchemaRole,
  SchemaSliceOut,
} from "./types.js";

export * from "./types.js";
export { AliasIndex, collision, handleKey, nameTokens } from "./aliases.js";
export type { AliasHit, CollisionKind } from "./aliases.js";
export { TUNABLES } from "./tunables.js";

/**
 * Every public method, enumerated. The totality test asserts the class exposes
 * EXACTLY this set — so a future `editBelief` / `setBeliefText` / `promote`
 * cannot be added without editing this list, in a module whose first guarantee
 * is that no such verb exists (§5 G1, scar §2.17's "write paths ship, curation
 * paths starve" read in reverse).
 */
export const PUBLIC_SURFACE = [
  // writes
  "mention",
  "addAliases",
  "addBelief",
  "addCurrentState",
  "challengeBelief",
  "fadeSweep",
  // reads
  "entity",
  "entities",
  "element",
  "beliefs",
  "currentState",
  "slices",
  "aliasIndex",
  "aliasMap",
  "bandOf",
  "fadeVerdict",
  "story",
  "lifecycle",
  "events",
] as const;

const EVENT_RING = 500;

interface MetaRecord {
  role: SchemaRole;
  /** entity rows only */
  name?: string;
  aliases?: string[];
  /** belief / current-state rows only */
  entityId?: string;
  statedOn?: string;
  statedOnDay?: number;
}

export interface SchemasOptions {
  store: Store;
  /** Telemetry sink. The ring is in memory only — see INTERFACE-GAPS §1. */
  onEvent?: (event: SchemaEvent) => void;
  /**
   * SEAMS item E — the supersede executor's edge callback, INJECTED because this
   * module must not import `associate/` (and `store.supersede` must not depend on
   * a core module above it). Wired to `Associate.retargetOnSupersede` at the
   * composition root; absent, the successor starts cold, which is scar §2.2
   * itself: *v1's `gist.merge` set `merged_into` and nothing re-pointed the
   * edges.* It is called in the SAME FLOW as the supersede, immediately after the
   * new id exists, so an arc cannot be half-moved by a caller that forgets.
   */
  retarget?: (oldId: string, newId: string, day: number) => void;
}

const ZERO_DIMS: DimensionsInput = { relevance: 0, emotional: 0, predictive: 0 };

export class Schemas {
  readonly store: Store;
  private readonly index = new AliasIndex();
  private readonly meta = new Map<string, MetaRecord>();
  private readonly byEntity = new Map<string, Set<string>>();
  private readonly birthsPerChunk = new Map<string, number>();
  private readonly increments: PressureIncrement[] = [];
  private readonly ring: SchemaEvent[] = [];
  private readonly onEvent: ((e: SchemaEvent) => void) | undefined;
  private readonly retarget: ((oldId: string, newId: string, day: number) => void) | undefined;

  private constructor(opts: SchemasOptions) {
    this.store = opts.store;
    this.onEvent = opts.onEvent;
    this.retarget = opts.retarget;
    this.load();
  }

  static open(opts: SchemasOptions): Schemas {
    return new Schemas(opts);
  }

  /**
   * One scan at open, because box 2 indexes type/kind/band/archived and has no
   * meta query (INTERFACE-GAPS §2). Prose is read directly rather than through
   * `Store.read`, so building an index does not spend the store's
   * archived-read telemetry — that event answers "did anyone look at archived
   * CONTENT", and an index build is not a look.
   */
  private load(): void {
    for (const id of this.store.list({ type: "schema" })) {
      const row = this.store.row(id);
      if (row === undefined) continue;
      const doc = readProseFile(row.prose_path, id);
      const rec = toMetaRecord(doc.meta);
      if (rec === null) continue;
      this.remember(id, rec);
      if (rec.role === "entity" && row.archived === 0) {
        this.index.register(id, rec.name ?? "", rec.aliases ?? []);
      }
    }
  }

  private remember(id: string, rec: MetaRecord): void {
    this.meta.set(id, rec);
    if (rec.entityId !== undefined) {
      const set = this.byEntity.get(rec.entityId) ?? new Set<string>();
      set.add(id);
      this.byEntity.set(rec.entityId, set);
    }
  }

  private emit(
    event: string,
    ref?: string,
    data?: Record<string, string | number | boolean | null>,
  ): void {
    const e: SchemaEvent = { at: Date.now(), event };
    if (ref !== undefined) e.ref = ref;
    if (data !== undefined) e.data = data;
    this.ring.push(e);
    if (this.ring.length > EVENT_RING) this.ring.shift();
    this.onEvent?.(e);
  }

  /** Copies, oldest first, optionally filtered by name. */
  events(name?: string): SchemaEvent[] {
    return this.ring.filter((e) => name === undefined || e.event === name).map((e) => ({ ...e }));
  }

  // ── birth by mention ───────────────────────────────────────────────────────

  /**
   * A newly-named entity becomes a stub schema immediately.
   *
   * There is no approval gate and no proposal queue: v1's autonomous-birth gate
   * recorded zero births AND zero refusals across 89 interpreter runs — "a gate
   * with no knocks is unmeasured" — so what survives is only the MECHANICAL
   * grounds, which are cheap and still true. Every one of them refuses loudly
   * with its own reason, and THE PROPOSAL IS LOGGED WHATEVER HAPPENS (scar
   * §2.4): "refused" and "never proposed to" must never again be the same
   * record.
   *
   * A newborn schema asserts nothing — names and aliases only (§5 G6). Its
   * salience is zero, which is not a slight: it is what makes death-by-decay
   * the default for a name nobody says twice.
   *
   * A name whose previous entity FADED is a new birth, not a resurrection: the
   * old entity died by physics, and the mention is a fresh place for memories
   * to attach. The old id stays resolvable and keeps its exit in the lifecycle
   * counts, and the birth is tagged `schema.birth.after-fade` so churn —
   * born, faded, born again — is a countable fact rather than an argument
   * (NOTES §6).
   */
  mention(input: MentionInput): BirthOutcome {
    const name = input.name.trim();
    const nameHash = hashText(handleKey(name));
    this.emit("schema.mention", input.chunkRef, {
      nameHash,
      kind: input.kind,
      day: input.day,
      aliasesDeclared: input.aliases?.length ?? 0,
    });

    const refuse = (reason: BirthReason, collidedWith: string[] = []): BirthOutcome => {
      this.emit("schema.birth.refused", input.chunkRef, {
        nameHash,
        kind: input.kind,
        reason,
        collided: collidedWith.length,
      });
      return {
        ok: false,
        reason,
        id: null,
        born: false,
        collidedWith,
        droppedAliases: [],
        keptAliases: [],
        reinforced: false,
      };
    };

    // Layer 1 of "never a second self", checked FIRST and independently of every
    // other ground: one identity core, and a second is a category error no
    // evidence could justify (§5 G5).
    if (input.kind === "self") return refuse("second-self-refused");
    if (!isBirthKind(input.kind)) return refuse("kind-not-allowed");
    if (name.length < TUNABLES.NAME_MIN_CHARS) return refuse("name-empty");
    // A credential must never become an entity the store indexes (encode's ops rule).
    if (containsSecret(name)) return refuse("name-is-secret");
    // The ONE whole-word rule, the same call preselection makes (SEAMS §7).
    if (!occursAsWholeWord(input.source, name)) return refuse("name-not-in-source");

    const exact = this.index.lookup(name).filter((id) => this.meta.get(id)?.role === "entity");
    if (exact.length > 1) return refuse("ambiguous-existing-name", exact);
    const hit = exact[0];
    if (hit !== undefined) {
      const row = this.store.row(hit);
      // Layer 2: a name that resolves to the identity core is not a birth site,
      // whatever kind the mention claimed.
      if (row?.kind === "self") return refuse("second-self-refused", [hit]);
      if (row !== undefined && row.kind !== input.kind) {
        return refuse("collision-exact-different-kind", [hit]);
      }
      return this.reMention(hit, input, nameHash);
    }

    const near = this.nearCollisions(name);
    if (near.length > 0) return refuse("collision-near", near);

    const used = this.birthsPerChunk.get(input.chunkRef) ?? 0;
    if (used >= TUNABLES.MAX_BIRTHS_PER_CHUNK) return refuse("birth-cap-per-chunk");

    return this.birth(name, input.kind, input, nameHash);
  }

  /** An archived entity that held this exact name before it faded, if any. */
  private fadedNamed(name: string, except: string): string | undefined {
    const key = handleKey(name);
    for (const [id, rec] of this.meta) {
      if (id === except || rec.role !== "entity") continue;
      if (handleKey(rec.name ?? "") !== key) continue;
      if (this.store.row(id)?.archived === 1) return id;
    }
    return undefined;
  }

  private nearCollisions(name: string): string[] {
    const out: string[] = [];
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      if (!this.index.has(id)) continue;
      const terms = [rec.name ?? "", ...(rec.aliases ?? [])];
      if (terms.some((t) => collision(name, t) === "near")) out.push(id);
    }
    return out.sort();
  }

  /**
   * The same name, twice: ONE entity. Dedup does not consume the chunk's birth
   * budget — the budget guards against a confused chunk inventing five things,
   * not against a span saying one thing twice.
   *
   * A re-mention REINFORCES at the `referenced` tier: a mention is the entity
   * being used, and physics refuses the credit on the birth day and again on any
   * day already credited, so "accumulates" means distinct lived days by
   * construction (NOTES §4).
   */
  private reMention(id: string, input: MentionInput, nameHash: string): BirthOutcome {
    const credit = this.store.reinforce(id, input.day, TUNABLES.MENTION_TIER);
    this.emit("schema.mention.existing", id, {
      nameHash,
      day: input.day,
      credited: credit.credited,
      creditReason: credit.reason,
    });
    return {
      ok: true,
      reason: "existing",
      id,
      born: false,
      collidedWith: [],
      droppedAliases: [],
      keptAliases: this.index.termsFor(id)?.aliases ?? [],
      reinforced: credit.credited,
    };
  }

  private birth(
    name: string,
    kind: BirthKind,
    input: MentionInput,
    nameHash: string,
  ): BirthOutcome {
    const gated = gateAliases(input.aliases, input.source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason as string }));
    const kept: string[] = [];
    keptIndices(input.aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined) return;
      // A key pointing at two things retrieves neither well: an alias already
      // resolving elsewhere is DROPPED, never fatal (§14.3). Reported by the
      // index it was DECLARED at, like every other drop.
      if (this.index.lookup(alias).length > 0) {
        dropped.push({ index: declaredIndex, reason: "alias-resolves-elsewhere" });
        return;
      }
      kept.push(alias);
    });
    for (const d of dropped) {
      this.emit("schema.alias.dropped", input.chunkRef, { index: d.index, reason: d.reason });
    }

    const seam = clampSalienceAtSeam({ novelty: null, ...ZERO_DIMS }, null);
    const id = this.store.put({
      type: "schema",
      kind,
      title: name,
      body: stubBody(name, kept, input.day),
      meta: { role: "entity", name, aliases: kept },
      salience: seam.salience,
      physics: { birthDay: input.day, lastUsedDay: input.day },
    });
    this.remember(id, { role: "entity", name, aliases: kept });
    this.index.register(id, name, kept);
    this.birthsPerChunk.set(input.chunkRef, (this.birthsPerChunk.get(input.chunkRef) ?? 0) + 1);
    const priorlyFaded = this.fadedNamed(name, id);
    if (priorlyFaded !== undefined) {
      this.emit("schema.birth.after-fade", id, { nameHash, priorId: priorlyFaded, day: input.day });
    }
    this.emit("schema.birth", id, {
      nameHash,
      kind,
      day: input.day,
      aliases: kept.length,
      aliasesDropped: dropped.length,
      chunkRef: input.chunkRef,
    });
    return {
      ok: true,
      reason: "born",
      id,
      born: true,
      collidedWith: [],
      droppedAliases: dropped,
      keptAliases: kept,
      reinforced: false,
    };
  }

  /**
   * The explicit alias operation (§4.2 G4). Aliases change HERE and nowhere
   * else — never as a side effect of editing prose, which is why there is no
   * path that re-reads names out of a body.
   */
  addAliases(
    id: string,
    aliases: readonly string[],
    source: string,
    day: number,
  ): { ok: boolean; reason: string; kept: string[]; dropped: { index: number; reason: string }[] } {
    const rec = this.meta.get(id);
    if (rec === undefined || rec.role !== "entity") {
      this.emit("schema.alias.refused", id, { reason: "entity-unknown" });
      return { ok: false, reason: "entity-unknown", kept: [], dropped: [] };
    }
    const gated = gateAliases(aliases, source);
    const dropped = gated.dropped.map((d) => ({ index: d.index, reason: d.reason as string }));
    const existing = rec.aliases ?? [];
    const kept = [...existing];
    keptIndices(aliases, gated.dropped).forEach((declaredIndex, i) => {
      const alias = gated.kept[i];
      if (alias === undefined) return;
      if (this.index.lookup(alias).filter((o) => o !== id).length > 0) {
        dropped.push({ index: declaredIndex, reason: "alias-resolves-elsewhere" });
        return;
      }
      if (!kept.some((k) => handleKey(k) === handleKey(alias))) kept.push(alias);
    });
    const next: MetaRecord = { role: "entity", name: rec.name ?? "", aliases: kept };
    this.store.revise(id, { meta: { role: "entity", name: next.name, aliases: kept }, reason: "alias-op" });
    this.meta.set(id, next);
    this.index.register(id, next.name ?? "", kept);
    for (const d of dropped) {
      this.emit("schema.alias.dropped", id, { index: d.index, reason: d.reason });
    }
    this.emit("schema.alias.registered", id, { kept: kept.length, dropped: dropped.length, day });
    return { ok: true, reason: "registered", kept, dropped };
  }

  // ── beliefs and current state ──────────────────────────────────────────────

  /**
   * Mint a belief on an entity. The row's kind is the ENTITY's kind, which is
   * how "revision bars differ by kind" becomes arithmetic rather than policy:
   * a belief about a person inherits iota 0.8, project state on an entity 0.5 —
   * the loosening chosen out loud (§4.3).
   */
  addBelief(input: BeliefInput): BeliefOutcome {
    const entity = this.requireEntity(input.entityId);
    if (entity.problem !== null) {
      this.emit("schema.belief.refused", input.entityId, { reason: entity.problem });
      return { ok: false, reason: entity.problem, id: null };
    }
    const statement = input.statement.trim();
    if (statement.length === 0) {
      this.emit("schema.belief.refused", input.entityId, { reason: "statement-empty" });
      return { ok: false, reason: "statement-empty", id: null };
    }
    const put = this.mintElement({
      role: "belief",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      dimensions: input.dimensions,
      claimedSalience: input.claimedSalience ?? null,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      protectedFlag: input.protected === true,
      meta: { groundedIn: [...(input.groundedIn ?? [])] },
    });
    this.emit("schema.belief.added", put, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      protected: input.protected === true,
    });
    return { ok: true, reason: "added", id: put };
  }

  /**
   * Timestamped status about an entity — and THE PLACEMENT RULE.
   *
   * v1 measured ~72 KB of dated project status rendered verbatim into every
   * self-keyed prompt, with 14 of self's 19 active beliefs about projects that
   * had no retrieval key of their own. The corrective is not a cleanup pass; it
   * is that this seam refuses, by name, to put status in identity. Status has
   * homes — they are entities — and the refusal says so.
   */
  addCurrentState(input: CurrentStateInput): PlacementOutcome {
    const entity = this.requireEntity(input.entityId);
    if (entity.problem !== null) {
      this.emit("schema.placement.refused", input.entityId, { reason: entity.problem });
      return { ok: false, reason: entity.problem, id: null, belongsOn: null };
    }
    if (entity.row.kind === "self") {
      const reason: PlacementReason = "status-on-identity-refused";
      this.emit("schema.placement.refused", input.entityId, {
        reason,
        day: input.day,
        statementHash: hashText(input.statement),
      });
      return { ok: false, reason, id: null, belongsOn: [...BIRTH_KINDS] };
    }
    const statement = input.statement.trim();
    if (statement.length === 0) {
      this.emit("schema.placement.refused", input.entityId, { reason: "statement-empty" });
      return { ok: false, reason: "statement-empty", id: null, belongsOn: null };
    }
    const statedOn = input.statedOn ?? today();
    const id = this.mintElement({
      role: "current-state",
      entityId: input.entityId,
      kind: entity.row.kind,
      body: statement,
      day: input.day,
      dimensions: input.dimensions,
      claimedSalience: input.claimedSalience ?? null,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      protectedFlag: false,
      happenedOn: statedOn,
      meta: { statedOn, statedOnDay: input.day },
    });
    this.emit("schema.state.placed", id, {
      entityId: input.entityId,
      kind: entity.row.kind,
      day: input.day,
      statedOn,
    });
    return { ok: true, reason: "placed", id, belongsOn: null };
  }

  private requireEntity(
    id: string,
  ): { problem: "entity-unknown" | "entity-archived" | null; row: MemoryRow } {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined) {
      return { problem: "entity-unknown", row: row ?? ({} as MemoryRow) };
    }
    if (row.archived === 1) return { problem: "entity-archived", row };
    return { problem: null, row };
  }

  private mintElement(spec: {
    role: SchemaRole;
    entityId: string;
    kind: Kind;
    body: string;
    day: number;
    dimensions?: DimensionsInput;
    claimedSalience: number | null;
    /** See `BeliefInput.channel`. Default "authored"; the ceiling and the
     *  persisted `source` both derive from it — engine-set, never claimable. */
    channel?: "authored" | "fallback" | "episode" | "accommodation" | "migrated";
    protectedFlag: boolean;
    happenedOn?: string;
    meta?: Record<string, unknown>;
    salience?: Salience;
    seed?: Partial<MemoryPhysics>;
  }): string {
    // The CEILING derives from the channel with "authored" as the arithmetic
    // default — but the PERSISTED source is `spec.channel ?? null`: a caller
    // that says nothing records "unrecorded", never a claim of authorship. The
    // PR-2 review's blocker was exactly this conflation: a `?? "authored"`
    // persistence default stamped every migrated belief as authored-in-v2.
    const channel = spec.channel ?? "authored";
    let salience: Salience;
    if (spec.salience !== undefined) {
      salience = spec.salience;
    } else {
      // novelty is null for an engine mint and is RECORDED as null, never
      // defaulted: novelty is prediction error at encoding, and this is not one.
      //
      // The reteller's cap applies HERE TOO (owner ruling 2026-08-29): this was
      // the doctrine's latent second door — a belief placed on behalf of a
      // transcript sweep would have carried the model's uncapped claim. No live
      // caller uses the fallback channel today; when one is built, the cap is
      // already structural.
      const seam = clampSalienceAtSeam(
        { novelty: null, ...(spec.dimensions ?? ZERO_DIMS) },
        spec.claimedSalience,
        channel === "fallback" ? PHYSICS_TUNABLES.SWEEP_CLAIM_CEILING : 1,
      );
      if (seam.event !== null) {
        this.emit("salience.lifted", spec.entityId, {
          computed: seam.event.computed,
          claimed: seam.event.claimed,
          applied: seam.event.applied,
          ceiling: seam.event.ceiling,
          capped: seam.event.capped,
        });
      }
      salience = seam.salience;
    }
    const meta: Record<string, unknown> = {
      role: spec.role,
      entityId: spec.entityId,
      ...(spec.meta ?? {}),
    };
    const put: PutInput = {
      type: "schema",
      kind: spec.kind,
      // The statement crosses the secrets gate on its way to disk (PR-6 review
      // SF1): the direct addBelief/addCurrentState API gated the entity NAME
      // and the aliases but never the STATEMENT body — so a credential could
      // live in a belief on disk (and reach both the sweep prompt and the
      // embedder, which redact at their own edges, but the store held it raw).
      // Redacting at THE SOURCE closes all three at once, the way migrate's
      // own runGate already treats a statement.
      body: redactSecrets(spec.body),
      meta,
      salience,
      physics: {
        birthDay: spec.day,
        lastUsedDay: spec.day,
        protected: spec.protectedFlag,
        ...(spec.seed ?? {}),
      },
      ...(spec.channel === undefined ? {} : { source: spec.channel }),
    };
    if (spec.happenedOn !== undefined) put.happenedOn = spec.happenedOn;
    const id = this.store.put(put);
    const rec: MetaRecord = { role: spec.role, entityId: spec.entityId };
    if (spec.meta?.["statedOn"] !== undefined) rec.statedOn = spec.meta["statedOn"] as string;
    if (spec.meta?.["statedOnDay"] !== undefined) {
      rec.statedOnDay = spec.meta["statedOnDay"] as number;
    }
    this.remember(id, rec);
    return id;
  }

  // ── revision ───────────────────────────────────────────────────────────────

  /**
   * One declared challenge against one belief, on one lived day (§5.6).
   *
   * The declaration is RESOLVED THROUGH THE SUPERSEDE CHAIN before physics sees
   * it — `store.resolve()` is the one retarget site every write path crosses
   * (§5 G10, scar §2.2). Without it, a challenge naming a belief that was
   * revised last week comes back `target-mismatch` and the evidence is lost:
   * v1's dangling-ledger-after-supersede, rebuilt by accident.
   *
   * The pressure field lives ON THE TARGET ROW; there is no second object, so
   * the whole dangling-ledger family cannot recur. Every credited increment is
   * logged with its force, its running pressure and the bar it is climbing
   * toward — the pressure history IS the evidence record, and it is what the
   * dashboard's story view reads.
   */
  challengeBelief(input: ChallengeInput): RevisionOutcome {
    const refuse = (reason: RevisionReason, targetId: string | null): RevisionOutcome => {
      this.emit("schema.revision.refused", targetId ?? input.updates, {
        reason,
        challengerId: input.challengerId,
        day: input.day,
      });
      return {
        verdict: "hold",
        reason,
        credited: false,
        targetId,
        retargeted: false,
        successorId: null,
        force: 0,
        pressureBefore: 0,
        pressureAfter: 0,
        bar: 0,
        increment: null,
      };
    };

    if (input.updates.trim().length === 0) return refuse("no-declared-target", null);

    let targetId: string;
    try {
      targetId = this.store.resolve(input.updates);
    } catch {
      return refuse("target-unresolvable", null);
    }
    const retargeted = targetId !== input.updates;
    if (retargeted) {
      this.emit("schema.revision.retargeted", targetId, {
        declared: input.updates,
        day: input.day,
      });
    }

    const rec = this.meta.get(targetId);
    if (rec === undefined || rec.role !== "belief") return refuse("target-not-a-belief", targetId);
    const row = this.store.row(targetId);
    if (row === undefined) return refuse("target-unresolvable", targetId);
    // Superseded targets already resolved away above, so an archived row here is
    // archived on purpose — a distinct fact from "not a belief".
    if (row.archived === 1) return refuse("target-archived", targetId);

    const target = this.store.physicsOf(targetId);
    // Protected elements refuse every revision path, always (§5 G11). Checked
    // BEFORE the arithmetic, so a protected belief accrues no pressure at all:
    // permanence that quietly accumulated a case against itself would be a
    // different, worse guarantee.
    if (target.protected) return refuse("protected-refuses-revision", targetId);

    const challengerRow = this.store.row(input.challengerId);
    if (challengerRow === undefined) return refuse("challenger-unknown", targetId);
    const challenger = this.store.physicsOf(input.challengerId);

    const outcome = applyChallenge(
      targetId,
      target,
      // The RESOLVED id is what physics is told, and the raw declaration stays in
      // the retarget event: the model proposes semantics, the engine resolves
      // references (scar §2.5).
      { id: input.challengerId, declaredUpdates: targetId, physics: challenger },
      input.day,
    );

    let increment: PressureIncrement | null = null;
    if (outcome.credited) {
      this.store.updatePhysics(targetId, outcome.next);
      const log = outcome.log;
      if (log !== null) {
        increment = {
          event: "revision.pressure",
          targetId,
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar,
        };
        this.increments.push(increment);
        // SEAMS item K — the increment is DURABLE, not just ringed. Restart the
        // process and the pressure number used to survive while the story of how
        // it got there did not (INTERFACE-GAPS.md §1; constitution line 16 says
        // the owner can see what changed and why). One credited challenge per
        // target per day (physics §5.6), so `(target, day, challenger)` is a
        // natural latch and a replayed day appends nothing twice.
        this.store.appendEvent({
          name: "revision.pressure",
          day: log.day,
          ref: targetId,
          dedupKey: `revision.pressure:${targetId}:${log.day}:${log.challengerId}`,
          payload: {
            targetId,
            day: log.day,
            challengerId: log.challengerId,
            force: log.force,
            pressureAfter: log.pressureAfter,
            bar: log.bar,
          },
        });
        this.emit("revision.pressure", targetId, {
          day: log.day,
          challengerId: log.challengerId,
          force: log.force,
          pressureAfter: log.pressureAfter,
          bar: log.bar,
        });
      }
    }

    let successorId: string | null = null;
    if (outcome.verdict === "revise") {
      successorId = this.supersedeBelief(targetId, rec, row, input, challenger);
    }

    return {
      verdict: outcome.verdict,
      reason: outcome.reason as RevisionReason,
      credited: outcome.credited,
      targetId,
      retargeted,
      successorId,
      force: outcome.force,
      pressureBefore: outcome.pressureBefore,
      pressureAfter: outcome.pressureAfter,
      bar: outcome.bar,
      increment,
    };
  }

  /**
   * Revision keeps its reason: the old element is retained as superseded with
   * lineage, and stays resolvable (§5 G10, earned live 2026-08-24 when
   * accommodation's forensics needed the retained element).
   *
   * The successor carries the target's `entityId` and `belief` role. Miss that
   * and the revised belief silently detaches from its schema — it stops
   * appearing in slices and in its own story, and nothing else fails.
   */
  private supersedeBelief(
    targetId: string,
    rec: MetaRecord,
    row: MemoryRow,
    input: ChallengeInput,
    challenger: MemoryPhysics,
  ): string {
    const statement = (input.statement ?? this.store.readProse(input.challengerId).body).trim();
    const entityId = rec.entityId ?? "";
    const seed = successorSeed(this.store.physicsOf(targetId));
    const successorId = this.store.supersede(
      targetId,
      {
        type: "schema",
        kind: row.kind,
        body: statement,
        meta: {
          role: "belief",
          entityId,
          revisedFrom: targetId,
          groundedIn: [input.challengerId],
        },
        // The evidence that carried the revision sets the successor's salience:
        // a belief is as strongly held as what made it (NOTES §3).
        salience: challenger.salience,
        physics: { birthDay: input.day, lastUsedDay: input.day, ...seed },
        // The channel vocabulary's fifth member finally has its writer (PR-2
        // review should-fix 1): an accommodation successor is the engine
        // revising under pressure, and its provenance is the challenger.
        source: "accommodation",
        origin: { ref: input.challengerId },
      },
      "revised-by-pressure",
    );
    this.remember(successorId, { role: "belief", entityId });
    // SEAMS item E, in the same flow as the supersede: the successor inherits the
    // old head's live edges. A retarget that THROWS must not undo a revision that
    // already landed — the belief is superseded either way, and a cold successor
    // is a recoverable loss where a half-applied revision is not.
    if (this.retarget !== undefined) {
      try {
        this.retarget(targetId, successorId, input.day);
        this.emit("schema.edges.retargeted", targetId, { successorId, day: input.day });
      } catch (err) {
        this.emit("schema.edges.retarget.failed", targetId, {
          successorId,
          day: input.day,
          error: err instanceof Error ? err.name : "UNKNOWN",
        });
      }
    }
    const record = supersedeRecord(targetId, successorId, input.day);
    this.emit("memory.superseded", targetId, {
      successorId,
      day: record.day,
      resolvableUntilDay: record.resolvableUntilDay,
    });
    this.emit("schema.belief.revised", successorId, {
      predecessorId: targetId,
      entityId,
      day: input.day,
    });
    return successorId;
  }

  // ── death by decay ─────────────────────────────────────────────────────────

  /**
   * Would this entity fade today, and if not, why not — EVERY reason, not the
   * first (§5 G7). Death is decay: physics decides, and this module adds one
   * blocker of its own, because an entity with live beliefs or live status is a
   * place memories are still attached to (open question 1; NOTES §5).
   */
  fadeVerdict(id: string, day: number): FadeVerdict {
    const row = this.store.row(id);
    const rec = this.meta.get(id);
    if (row === undefined || rec === undefined || rec.role !== "entity") {
      // "there is no such entity" and "it already faded" are different facts,
      // and a shared reason string would make them one (scar §2.4).
      return {
        fade: false,
        reason: "not-an-entity",
        blockedBy: ["not-an-entity"],
        strength: 0,
        band: "episodic",
        dwellDays: 0,
        attached: 0,
      };
    }
    const p = this.store.physicsOf(id);
    if (row.archived === 1) {
      return {
        fade: false,
        reason: "already-archived",
        blockedBy: ["already-archived"],
        strength: strengthOf(p, day),
        band: bandOfPhysics(p, day),
        dwellDays: day - p.lastUsedDay,
        attached: this.liveElementIds(id).length,
      };
    }
    const v = pruneVerdict(p, day, { inLiveRevisionChain: false });
    const attached = this.liveElementIds(id).length;
    // `prunable` is physics' OK value and never appears among blockers; the
    // filter is there so the two vocabularies cannot silently diverge.
    const blockedBy: FadeReason[] = v.blockedBy.filter(
      (r): r is Exclude<typeof r, "prunable"> => r !== "prunable",
    );
    if (attached > 0) blockedBy.push("has-live-attached-elements");
    return {
      fade: blockedBy.length === 0,
      reason: blockedBy[0] ?? "faded",
      blockedBy,
      strength: v.strength,
      band: v.band,
      dwellDays: v.dwellDays,
      attached,
    };
  }

  /**
   * The sweep. Archive is a STATE, not a deletion: a faded entity keeps its id,
   * stays resolvable, and simply stops surfacing (§4.2 G3). No model, on any
   * path, holds this power — it is arithmetic on a lived day.
   */
  fadeSweep(day: number): FadeReport {
    const faded: string[] = [];
    let examined = 0;
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1) continue;
      examined += 1;
      const v = this.fadeVerdict(id, day);
      if (!v.fade) continue;
      this.store.archive(id, TUNABLES.FADE_REASON);
      this.index.unregister(id);
      faded.push(id);
      this.emit("schema.faded", id, {
        day,
        kind: row.kind,
        strength: v.strength,
        dwellDays: v.dwellDays,
        birthDay: row.birth_day,
      });
    }
    this.emit("schema.fade.sweep", undefined, { day, examined, faded: faded.length });
    return { day, examined, faded };
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  entity(id: string): EntityView | undefined {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || rec.role !== "entity" || row === undefined) return undefined;
    return {
      id,
      name: rec.name ?? "",
      kind: row.kind,
      aliases: [...(rec.aliases ?? [])],
      archived: row.archived === 1,
      archivedReason: row.archived_reason,
      birthDay: row.birth_day,
    };
  }

  entities(opts: { includeArchived?: boolean } = {}): EntityView[] {
    const out: EntityView[] = [];
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const view = this.entity(id);
      if (view === undefined) continue;
      if (view.archived && opts.includeArchived !== true) continue;
      out.push(view);
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  element(id: string): ElementView | undefined {
    const rec = this.meta.get(id);
    const row = this.store.row(id);
    if (rec === undefined || row === undefined) return undefined;
    if (rec.role === "entity") return undefined;
    const view: ElementView = {
      id,
      entityId: rec.entityId ?? "",
      role: rec.role,
      statement: readProseFile(row.prose_path, id).body,
      kind: row.kind,
      archived: row.archived === 1,
      supersededBy: row.superseded_by,
      protected: row.protected === 1,
      salience: this.store.physicsOf(id).salience,
    };
    if (rec.statedOn !== undefined) view.statedOn = rec.statedOn;
    if (rec.statedOnDay !== undefined) view.statedOnDay = rec.statedOnDay;
    return view;
  }

  private liveElementIds(entityId: string, role?: SchemaRole): string[] {
    const out: string[] = [];
    for (const id of this.byEntity.get(entityId) ?? []) {
      const rec = this.meta.get(id);
      if (rec === undefined) continue;
      if (role !== undefined && rec.role !== role) continue;
      const row = this.store.row(id);
      if (row === undefined || row.archived === 1) continue;
      out.push(id);
    }
    return out.sort();
  }

  beliefs(entityId: string): ElementView[] {
    return this.liveElementIds(entityId, "belief")
      .map((id) => this.element(id))
      .filter((e): e is ElementView => e !== undefined);
  }

  currentState(entityId: string): ElementView[] {
    return this.liveElementIds(entityId, "current-state")
      .map((id) => this.element(id))
      .filter((e): e is ElementView => e !== undefined);
  }

  /**
   * What the author is shown at encoding (§8 G7). Beliefs and current state are
   * VERBATIM — a paraphrase of a belief cannot be honestly confirmed or
   * contradicted, and contradiction detection is the whole reason the slice
   * exists — and each element carries its ID, the address an `updates:`
   * declaration names. Faded entities are absent: that is what "fades out of
   * preselection" means.
   *
   * `excludeProtected` is the INTERPRETER's view (§14.1 G2: protected elements
   * never render into the falsification path — a model must not be handed the
   * one class of statement it is forbidden to challenge). The filter is
   * PER-ELEMENT, never per-entity, and every filtered element is COUNTED in
   * `elided` rather than silently absent (§5 G8). One builder serves both the
   * prompt cards and the gate slices, so the two surfaces cannot drift.
   */
  slices(opts: { excludeProtected?: boolean } = {}): SchemaSliceOut[] {
    return this.entities().map((e) => {
      let elided = 0;
      const keep = (v: ElementView): boolean => {
        if (opts.excludeProtected === true && v.protected) {
          elided += 1;
          return false;
        }
        return true;
      };
      const beliefs = this.beliefs(e.id)
        .filter(keep)
        .map((b) => ({ id: b.id, statement: b.statement }));
      const currentState = this.currentState(e.id)
        .filter(keep)
        .map((c) => ({ id: c.id, statement: c.statement }));
      return { id: e.id, name: e.name, aliases: [...e.aliases], beliefs, currentState, elided };
    });
  }

  /** The index recall borrows (SEAMS §6). Live object; treat it as read-only. */
  aliasIndex(): AliasIndex {
    return this.index;
  }

  /** Handle -> ids, the shape `recall/`'s `Turn.aliases` wants. */
  aliasMap(): ReadonlyMap<string, readonly string[]> {
    return this.index.map();
  }

  /** READ ONLY. Promotion is physics'/sleep's counted crossing, never this
   *  module's — there is no write path to a band in this directory. */
  bandOf(id: string, day: number): Band {
    return bandOfPhysics(this.store.physicsOf(id), day);
  }

  /**
   * The revision story of one belief, for the dashboard (constitution line 16):
   * the lineage the store retained, the pressure standing on the live head, the
   * bar it is climbing toward, and every credited increment this session logged.
   */
  story(beliefId: string): BeliefStory {
    const chain: string[] = [];
    let cursor: string | undefined = beliefId;
    const lineage: LineageStep[] = [];
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      for (const v of this.store.versions(cursor)) {
        lineage.push({
          id: cursor,
          seq: v.seq,
          reason: v.reason,
          day: v.version_day,
          successorId: v.successor_id,
        });
      }
      const row: MemoryRow | undefined = this.store.row(cursor);
      cursor = row?.superseded_by ?? undefined;
    }
    const headId = chain[chain.length - 1] ?? beliefId;
    const head = this.store.row(headId);
    const p = head === undefined ? undefined : this.store.physicsOf(headId);
    return {
      beliefId,
      headId,
      lineage,
      pressure: p?.pressure ?? 0,
      lastChallengedDay: p?.lastChallengedDay ?? null,
      bar: p === undefined ? 0 : revisionBar(p, p.lastChallengedDay ?? p.birthDay),
      strength: p === undefined ? 0 : strengthOf(p, p.lastChallengedDay ?? p.birthDay),
      increments: this.storyIncrements(chain),
    };
  }

  /**
   * The durable increments first (box 2's `events` table — they survive a
   * restart), then anything this session logged that the log does not already
   * carry. The union is deduped on the same `(target, day, challenger)` latch the
   * append uses, so a story never shows one challenge twice.
   */
  private storyIncrements(chain: readonly string[]): PressureIncrement[] {
    const key = (i: { targetId: string; day: number; challengerId: string }): string =>
      `${i.targetId}:${i.day}:${i.challengerId}`;
    const out: PressureIncrement[] = [];
    const seen = new Set<string>();
    for (const row of this.store.eventLog({ name: "revision.pressure", limit: 1000 })) {
      if (row.ref === null || !chain.includes(row.ref) || row.payload === null) continue;
      try {
        const p = JSON.parse(row.payload) as Omit<PressureIncrement, "event">;
        const inc: PressureIncrement = { event: "revision.pressure", ...p };
        out.push(inc);
        seen.add(key(inc));
      } catch {
        // An unparseable payload is a lost line of the story, never a throw in
        // the dashboard's read path.
      }
    }
    for (const i of this.increments) {
      if (chain.includes(i.targetId) && !seen.has(key(i))) out.push(i);
    }
    return out;
  }

  /**
   * Guarantee 13: created versus exited, per kind. A kind that has minted
   * entities and never retired one is a defect to investigate, not a base rate
   * to accept (scar §2.17 — write paths ship, curation paths starve).
   */
  lifecycle(): LifecycleRow[] {
    const counts = new Map<Kind, { created: number; exited: number }>();
    for (const [id, rec] of this.meta) {
      if (rec.role !== "entity") continue;
      const row = this.store.row(id);
      if (row === undefined) continue;
      const c = counts.get(row.kind) ?? { created: 0, exited: 0 };
      c.created += 1;
      if (row.archived === 1 && row.archived_reason === TUNABLES.FADE_REASON) c.exited += 1;
      counts.set(row.kind, c);
    }
    return [...counts.entries()]
      .map(([kind, c]) => ({
        kind,
        created: c.created,
        exited: c.exited,
        noExitsYet: c.created > 0 && c.exited === 0,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }
}

/** A newborn schema is empty except its names — a place for memories to attach,
 *  never a claim about what is true of the thing (§14.3, §5 G6). */
function stubBody(name: string, aliases: readonly string[], day: number): string {
  const lines = [`# ${name}`, "", `Born by mention on lived day ${day}. Asserts nothing yet.`];
  if (aliases.length > 0) lines.push("", `Also called: ${aliases.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The DECLARED indices of the aliases the gate kept, in kept order. Drops are
 * reported by the position the author declared them at, never by their text
 * (§5 G10) — so a second drop reason downstream can speak the same language.
 */
function keptIndices(
  declared: readonly string[] | undefined,
  dropped: readonly { index: number }[],
): number[] {
  const gone = new Set(dropped.map((d) => d.index));
  const out: number[] = [];
  (declared ?? []).forEach((_, i) => {
    if (!gone.has(i)) out.push(i);
  });
  return out;
}

function toMetaRecord(meta: Record<string, unknown>): MetaRecord | null {
  const role = meta["role"];
  if (role !== "entity" && role !== "belief" && role !== "current-state") return null;
  const rec: MetaRecord = { role };
  if (typeof meta["name"] === "string") rec.name = meta["name"];
  if (Array.isArray(meta["aliases"])) {
    rec.aliases = (meta["aliases"] as unknown[]).filter((a): a is string => typeof a === "string");
  }
  if (typeof meta["entityId"] === "string") rec.entityId = meta["entityId"];
  if (typeof meta["statedOn"] === "string") rec.statedOn = meta["statedOn"];
  if (typeof meta["statedOnDay"] === "number") rec.statedOnDay = meta["statedOnDay"];
  return rec;
}
