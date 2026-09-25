#!/usr/bin/env bun
/**
 * `tools/demo/seed` — builds the SYNTHETIC store every launch screenshot comes from.
 *
 *   ~/.bun/bin/bun run tools/demo/seed.ts --dir /tmp/demo-store
 *   ~/.bun/bin/bun run tools/demo/seed.ts --temp
 *   ~/.bun/bin/bun run tools/demo/seed.ts --temp --empty
 *
 * Three rules this file exists to keep, in the order they matter:
 *
 *   1. **It can never touch a real store.** The target directory is an explicit
 *      argument or a fresh temp dir — there is no default, and `dataDir()`'s
 *      `~/.counterparts` fallback is never reached because nothing here reads the
 *      environment. `assertDemoTarget` refuses the owner's live memory and v1's
 *      by name (`store/paths.ts` only refuses the latter), and refuses any
 *      directory that already holds a store. A seeder that overwrote a real
 *      memory would be the worst bug in this repo.
 *   2. **Zero API calls.** No embedder, no live vectors, no interpreter, no
 *      sweep. The brain is composed exactly as the hermetic tests compose it, and
 *      every byte of content is authored here rather than generated.
 *   3. **Everything goes through a real door.** Memories through
 *      `submitSessionEnd` / `submitJot`, entities by mention, chapters through
 *      `appendEpisode`, revisions by writing `updates:` on an ordinary memory and
 *      letting `revision.ts` decide what it hit, days advanced by real
 *      `sessionEnd` cycles. Two deliberate exceptions are named at their call
 *      sites: PREHISTORY (`store.put` backdated, because a thirty-day store
 *      cannot reach `D_FLOOR_DAYS = 90` from birth) and the prospective
 *      intentions (prospectivity is DERIVED from a memory's date — there is no
 *      "create intention" door to use).
 *
 * Determinism: the clock is a fixed offset from a fixed epoch, the RNG is a
 * fixed-seed mulberry32, and the script is data. Two runs produce stores with
 * identical content — not identical BYTES, because ids are `randomBytes` at the
 * store seam and nothing here can change that. `test/demo-seed.test.ts` asserts
 * the content-level form.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { Counterpart } from "../../src/core/counterpart.js";
import { TUNABLES as PHYSICS, band } from "../../src/core/physics/index.js";
import { FORBIDDEN_ROOT_NAMES, REQUIRE_EXPLICIT_DIR_ENV } from "../../src/core/store/index.js";
import type { Kind } from "../../src/core/types.js";
import {
  BELIEFS,
  CAST,
  CHALLENGES,
  CURRENT_STATE,
  CURRENT_STATE_CORRECTION,
  DAYS,
  INTENTIONS,
  OWNER_NAME,
  PREHISTORY,
} from "./script.js";
import type { BeliefKey, Dims, Note } from "./script.js";

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Directories this tool refuses outright, resolved before comparison so
 * `~/.counterparts/../.counterparts/x` is caught too (the shape of scar §2.13).
 *
 * `store/paths.ts` refuses only `~/.bansai` and `~/.claude-engram`; `.counterparts`
 * is deliberately NOT on that list, because it is where the real store lives. So
 * this list is longer than the core's on purpose, and the extra entries are the
 * ones a demo seeder could plausibly be pointed at by accident.
 */
export const REFUSED_ROOT_NAMES: readonly string[] = [
  // The core's own list, IMPORTED rather than retyped, so the two cannot drift.
  ...FORBIDDEN_ROOT_NAMES,
  // And the ones only this tool needs, headed by the one that matters most.
  ".counterparts",
  ".memory-ab",
  "counterparts-parallel-run",
  "counterparts-backups",
];

/** Files whose presence means "there is already a store here". */
// Both spellings of the database on purpose: the floor renamed it to
// `counterparts.sqlite`, and a seeder that stopped recognising the old name
// would happily seed on top of a pre-rows store it can no longer open.
const STORE_MARKERS = [
  "counterparts.sqlite",
  "operational.sqlite",
  "prose",
  "cache",
  "versions",
] as const;

export class DemoTargetRefused extends Error {
  readonly reason: "live-store-root" | "not-absolute" | "store-already-here";
  readonly detail: string;
  constructor(reason: DemoTargetRefused["reason"], detail: string) {
    super(`demo seed refuses ${detail} (${reason})`);
    this.name = "DemoTargetRefused";
    this.reason = reason;
    this.detail = detail;
  }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The only way a directory becomes a seed target. Throws rather than returning a
 * flag: a caller who forgets to check a boolean is exactly how a guard fails.
 */
export function assertDemoTarget(dir: string): string {
  if (!isAbsolute(dir)) throw new DemoTargetRefused("not-absolute", dir);
  const target = resolve(dir);
  const home = homedir();
  for (const name of REFUSED_ROOT_NAMES) {
    if (isWithin(join(home, name), target)) {
      throw new DemoTargetRefused("live-store-root", `${target} — inside ~/${name}`);
    }
  }
  if (existsSync(target)) {
    const here = new Set(readdirSync(target));
    for (const marker of STORE_MARKERS) {
      if (here.has(marker)) {
        throw new DemoTargetRefused("store-already-here", `${target} — it holds ${marker}`);
      }
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Fixed-seed mulberry32. Jitter only — it never decides WHAT gets written. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RNG_SEED = 0x5eed10;
/** Wall-clock origin for the whole run: 2026-06-01T09:00:00Z. Fixed, so nothing
 *  in the store carries the real time this seeder happened to run at. */
export const EPOCH_MS = Date.UTC(2026, 5, 1, 9, 0, 0);

/**
 * Milliseconds from `EPOCH_MS` to 09:00 UTC on a scripted day.
 *
 * A demo store's dates are the demo's own, and the injected clock is what makes
 * them so: with it, `learnedOn` is the day the note was written in the story;
 * without it, every one of the 156 rows read the day the seeder happened to run
 * (measured 2026-09-04 — the whole wake said "2026-09-05 ·" on every line).
 */
function dayOffset(date: string): number {
  const at = Date.parse(`${date}T09:00:00Z`);
  if (Number.isNaN(at)) throw new Error(`demo script day is not a date: ${date}`);
  return at - EPOCH_MS;
}

/** The HOST's reported injection ceiling. It lives here because it lives in the
 *  host: nothing in `src/` may invent one (scar §2.18), and a seeder that passed
 *  none would publish no briefing at all. */
export const DEMO_BUDGET_BYTES = 9000;

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface SeedReport {
  readonly dir: string;
  readonly mode: "rich" | "empty";
  readonly livedDays: number;
  readonly memories: number;
  readonly memoriesByKind: Record<Kind, number>;
  readonly memoriesByBand: Record<string, number>;
  readonly entities: number;
  readonly beliefs: number;
  readonly currentState: number;
  readonly protectedElements: number;
  readonly identityElements: number;
  readonly episodes: number;
  readonly chapters: number;
  readonly contestedBeliefs: number;
  readonly revisedBeliefs: number;
  readonly replacedCurrentState: number;
  readonly pressureIncrements: number;
  readonly pruned: number;
  readonly merged: number;
  readonly promoted: number;
  readonly edges: number;
  readonly recallDecisions: number;
  readonly intentionsFired: number;
  readonly intentionsPending: number;
  readonly briefingBytes: number;
  /** Every deposit the gates refused, with its ground. Should be empty. */
  readonly refusals: readonly string[];
  /** Every declared revision, by the arm it took and the ground it named. */
  readonly revisionOutcomes: Record<string, number>;
}

// ---------------------------------------------------------------------------
// The seeder
// ---------------------------------------------------------------------------

export interface SeedOptions {
  readonly dir: string;
  readonly budgetBytes?: number;
}

/** An initialized store with nothing in it — the empty-state screenshots. */
export function seedEmpty(opts: SeedOptions): SeedReport {
  const dir = assertDemoTarget(opts.dir);
  mkdirSync(dir, { recursive: true });
  const c = Counterpart.open({ dir, owner: true, budgetBytes: opts.budgetBytes ?? DEMO_BUDGET_BYTES });
  c.close();
  return {
    dir,
    mode: "empty",
    livedDays: 0,
    memories: 0,
    memoriesByKind: { self: 0, person: 0, entity: 0, skill: 0, place: 0, fact: 0 },
    memoriesByBand: { episodic: 0, semantic: 0, identity: 0 },
    entities: 0,
    beliefs: 0,
    currentState: 0,
    protectedElements: 0,
    identityElements: 0,
    episodes: 0,
    chapters: 0,
    contestedBeliefs: 0,
    revisedBeliefs: 0,
    replacedCurrentState: 0,
    pressureIncrements: 0,
    pruned: 0,
    merged: 0,
    promoted: 0,
    edges: 0,
    recallDecisions: 0,
    intentionsFired: 0,
    intentionsPending: 0,
    briefingBytes: 0,
    refusals: [],
    revisionOutcomes: {},
  };
}

/**
 * The self-kind practice notes the run keeps referring back to. Reinforcement on
 * `N_PROMOTION_DAYS = 3` DISTINCT lived days is half of `promotionEligibility`;
 * a claimed salience at or above `THETA_ID` is the other half. Nothing is born
 * into the identity band (the 2026-08-25 ruling) — these earn it at a real
 * consolidation, which is the only door.
 */
const IDENTITY_TRACK: readonly string[] = [
  "self-paper-first",
  "self-which-thursday",
  "self-real-object",
  "self-unchecked-list",
  "self-sit-with",
];

/** One memory written twice, a fortnight apart. Sleep's dedup is content-hash
 *  based and needs no embedder; the authored door refuses a repeat by content,
 *  so this pair is the one place a body is written straight to the store to make
 *  a merge happen at all. Declared, not hidden. */
const DUPLICATE_BODY =
  "The ward's own protocol for two people wanting the same shift is a conversation, and every rule we write instead of it will be worked around.";

export async function seedDemo(opts: SeedOptions): Promise<SeedReport> {
  const dir = assertDemoTarget(opts.dir);
  mkdirSync(dir, { recursive: true });
  const budgetBytes = opts.budgetBytes ?? DEMO_BUDGET_BYTES;
  const random = rng(RNG_SEED);

  let offset = 0;
  const now = (): number => EPOCH_MS + offset;
  const refusals: string[] = [];
  /** Every `updates:` declaration and what it landed on. A revision that refused
   *  leaves no failed deposit, so without this the run reports success for a
   *  challenge that moved nothing. */
  const revisions: { path: string; reason: string }[] = [];

  // TWO OPENS, and the second one is not ceremony. `Schemas` builds its entity
  // index ONCE, at open (`schemas/index.ts` `load()`), and the composition root
  // mints the identity core AFTER that — so a brain opened with `identity` in
  // one call cannot place a belief on its own core in the same call
  // (`entity-unknown`, measured here on the first run). Minting it in a throwaway
  // open and reopening is the honest way through with no core change.
  //
  // THE STORY'S ZONE IS UTC. Its days are 09:00 UTC instants (`dayOffset`), and
  // since 2026-09-25 a row's `learned_on` is the local date of its moment
  // (docs/time.md) — so an unpinned seed run in Honolulu dated every row the day
  // before the story says. Pinned, the demo reads the same on every machine.
  Counterpart.open({ dir, owner: true, budgetBytes, identity: { name: OWNER_NAME }, now, timeZone: "UTC" }).close();

  const c = Counterpart.open({
    dir,
    owner: true,
    budgetBytes,
    now,
    timeZone: "UTC",
    onEvent: (e) => {
      if (e.name !== "counterpart.revision") return;
      revisions.push({
        path: String(e.data?.["path"] ?? "?"),
        reason: String(e.data?.["reason"] ?? "?"),
      });
    },
  });

  try {
    // ── prehistory ────────────────────────────────────────────────────────
    // See PREHISTORY's own comment: born long before the window and untouched,
    // so the first cycle's prune has something real to let go of.
    for (const [i, row] of PREHISTORY.entries()) {
      c.store.put({
        type: "memory",
        kind: row.kind,
        body: row.body,
        source: "migrated",
        learnedOn: "2026-01-12",
        salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0 },
        physics: { birthDay: -140 + i, lastUsedDay: -140 + i, uses: 0 },
      });
    }

    // The two SKILL entities. `mentionFromProposal` only births person / entity /
    // place from an authored title, so a skill's birth uses the module's own door.
    for (const skill of CAST.skills) {
      c.schemas.mention({
        name: skill.name,
        kind: "skill",
        source: `The assistant is getting better at ${skill.name}: ${skill.role}.`,
        chunkRef: `demo:skill:${skill.name}`,
        day: 0,
      });
    }

    const memoryIds = new Map<string, string>();
    const beliefIds = new Map<BeliefKey, string>();
    const currentStateIds = new Map<string, string>();
    const intentionIds = new Map<string, { id: string; windowKey: string; dueOn: string | null }>();
    const birthDayOf = new Map<string, number>();
    let chapters = 0;
    let fired = 0;
    let armed = 0;

    const identityCoreId = ((): string => {
      const found = c.schemas
        .entities()
        .find((e) => e.name === OWNER_NAME);
      return found?.id ?? "";
    })();

    /** Resolve a scripted `about` name to the entity it belongs on. */
    const entityFor = (name: string): string | null => {
      if (name === OWNER_NAME) return identityCoreId === "" ? null : identityCoreId;
      const hit = c.schemas.entities().find((e) => e.name === name);
      return hit?.id ?? null;
    };

    /** A little deterministic jitter, so the salience column is not a flat wall. */
    const jitter = (d: Dims): Dims => ({
      relevance: clamp01(d.relevance + (random() - 0.5) * 0.06),
      emotional: clamp01(d.emotional + (random() - 0.5) * 0.06),
      predictive: clamp01(d.predictive + (random() - 0.5) * 0.06),
    });

    const deposit = async (
      note: Note & { updates?: string },
      session: string,
      scope: string,
      where: string,
    ): Promise<string | null> => {
      const draft: Record<string, unknown> = {
        content: note.content,
        kind: note.kind,
        salience: jitter(note.dims),
      };
      if (note.title !== undefined) draft["title"] = note.title;
      if (note.claimed !== undefined) draft["claimed"] = note.claimed;
      if (note.unresolved === true) draft["unresolved"] = true;
      if (note.updates !== undefined) draft["updates"] = note.updates;
      const result = note.jot === true
        ? await c.submitJot(draft, { session, scope })
        : await c.submitSessionEnd(draft, { session, scope });
      if (!result.deposited || result.memoryId === null) {
        // LOUD. A silently refused deposit is how a seeder reports sixty
        // memories and ships fifty-eight.
        refusals.push(`${where}: ${result.reason}${result.gate === null ? "" : ` (${result.gate})`}`);
        return null;
      }
      if (note.key !== undefined) memoryIds.set(note.key, result.memoryId);
      birthDayOf.set(result.memoryId, c.store.livedDay());
      return result.memoryId;
    };

    // ── the thirty lived days ─────────────────────────────────────────────
    for (const [index, day] of DAYS.entries()) {
      // THE DAY'S OWN DATE, not its index (§I7). The script's thirty lived days
      // skip weekends — day 5 is 2026-06-08, not 2026-06-06 — so `index * DAY_MS`
      // put the wall clock four days behind the calendar by the end of the run
      // and every date the store wrote was a date the script never names. The
      // offset is READ OFF `day.date` instead, which makes the injected clock and
      // the physics clock agree by construction rather than by arithmetic that
      // happens to line up.
      offset = dayOffset(day.date);
      // The clock moves at the START of the day here rather than at the
      // boundary, so everything the day writes carries the day's own number.
      // `sessionEnd({date})` below sees the same date and its clock phase is a
      // no-op, which is exactly what a second boundary in one day does live.
      c.store.advanceClock(day.date);
      const livedDay = c.store.livedDay();
      const scope = "fernbrook/halfmoon";

      c.wake(budgetBytes);

      for (const [n, note] of day.notes.entries()) {
        await deposit(note, day.session, scope, `${day.date} note ${n}`);
      }

      // Beliefs and current state scheduled for this day.
      for (const belief of BELIEFS.filter((b) => b.onDay === index)) {
        const entityId = entityFor(belief.about);
        if (entityId === null) {
          refusals.push(`${day.date} belief ${belief.key}: no entity for ${belief.about}`);
          continue;
        }
        const out = c.schemas.addBelief({
          entityId,
          statement: belief.statement,
          day: livedDay,
          dimensions: jitter(belief.dims),
          ...(belief.claimed === undefined ? {} : { claimedSalience: belief.claimed }),
          ...(belief.protectedInk === true ? { protected: true } : {}),
        });
        if (out.id === null) refusals.push(`${day.date} belief ${belief.key}: ${out.reason}`);
        else beliefIds.set(belief.key, out.id);
      }
      for (const cs of CURRENT_STATE.filter((s) => s.onDay === index)) {
        const entityId = entityFor(cs.about);
        if (entityId === null) {
          refusals.push(`${day.date} current-state ${cs.key}: no entity for ${cs.about}`);
          continue;
        }
        const out = c.schemas.addCurrentState({
          entityId,
          statement: cs.statement,
          day: livedDay,
          statedOn: cs.statedOn,
          dimensions: jitter(cs.dims),
        });
        if (out.id === null) refusals.push(`${day.date} current-state ${cs.key}: ${out.reason}`);
        else currentStateIds.set(cs.key, out.id);
      }

      // The challenges — ordinary authored memories that declare `updates:`.
      // Nothing here calls `challengeBelief`: the point of the demo is that the
      // pressure story is produced by the same door the assistant writes through.
      for (const ch of CHALLENGES.filter((x) => x.onDay === index)) {
        const target = beliefIds.get(ch.target);
        if (target === undefined) {
          refusals.push(`${day.date} challenge ${ch.target}: belief not placed yet`);
          continue;
        }
        await deposit(
          { content: ch.content, kind: ch.kind, claimed: ch.claimed, dims: ch.dims, updates: target },
          day.session,
          scope,
          `${day.date} challenge ${ch.target}`,
        );
      }

      // The fast half of revision: a "now" fact corrected outright.
      if (CURRENT_STATE_CORRECTION.onDay === index) {
        const target = currentStateIds.get(CURRENT_STATE_CORRECTION.key);
        if (target === undefined) {
          refusals.push(`${day.date} correction: current-state not placed`);
        } else {
          await deposit(
            {
              content: CURRENT_STATE_CORRECTION.content,
              kind: CURRENT_STATE_CORRECTION.kind,
              claimed: CURRENT_STATE_CORRECTION.claimed,
              dims: CURRENT_STATE_CORRECTION.dims,
              updates: target,
            },
            day.session,
            scope,
            `${day.date} correction`,
          );
        }
      }

      // Prospective intentions. There is no "create intention" door: an
      // intention IS an ordinary memory carrying a date, and `prospective/`
      // derives the window on every read. `store.put` is used because the
      // authored draft has no field for `happenedOn` (filed as a gap).
      for (const intent of INTENTIONS.filter((i) => i.onDay === index)) {
        const id = c.store.put({
          type: "memory",
          kind: "fact",
          body: intent.text,
          learnedOn: day.date,
          ...(intent.dueOn === undefined ? {} : { happenedOn: intent.dueOn }),
          salience: { novelty: null, relevance: 0.8, emotional: 0.7, predictive: 0.85 },
          physics: { birthDay: livedDay, lastUsedDay: livedDay },
          origin: { session: day.session, scope },
        });
        birthDayOf.set(id, livedDay);
        intentionIds.set(intent.key, {
          id,
          windowKey: intent.dueOn === undefined ? "" : `d:${intent.dueOn}`,
          dueOn: intent.dueOn ?? null,
        });
      }

      // The duplicate pair, a fortnight apart, so sleep's dedup has a real merge.
      if (index === 5 || index === 19) {
        c.store.put({
          type: "memory",
          kind: "fact",
          body: DUPLICATE_BODY,
          learnedOn: day.date,
          salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.7 },
          physics: { birthDay: livedDay, lastUsedDay: livedDay },
          origin: { session: day.session, scope },
        });
      }

      // Recall on a few cues, so the surfacing decision leaves durable rows and
      // the activity feed has something to show.
      for (const cue of day.cues ?? []) {
        c.recallForTurn({ sessionId: day.session, text: cue }, { at: day.date });
      }

      // What the day's reply actually used. Only memories born on an EARLIER
      // lived day can be credited (`creditUse` refuses `birth-day`), so the list
      // is filtered rather than hoped over.
      const used = [
        ...new Set(
          [...(day.uses ?? []), ...(index >= 4 ? IDENTITY_TRACK : [])]
            .map((k) => memoryIds.get(k))
            .filter((id): id is string => id !== undefined && (birthDayOf.get(id) ?? livedDay) < livedDay),
        ),
      ];
      if (used.length > 0) {
        c.resolveUses(day.session, used.map((memoryId) => ({ memoryId, tier: "referenced" as const })));
      }

      // The journal. One ask, one chapter — the ask's substance is what a real
      // day of conversation looks like, well past `askDue`'s first-ask floor.
      if (day.chapter !== undefined) {
        c.episodeAsk(day.session, { turns: 9 + Math.floor(random() * 4), bytes: 6200 }, livedDay);
        const written = c.appendEpisode(day.session, day.chapter, {
          day: livedDay,
          title: `Halfmoon pilot — ${day.date}`,
          happenedOn: day.date,
        });
        if (written.appended) chapters += 1;
        else refusals.push(`${day.date} chapter: ${written.reason}`);
      }

      // Prospective firing: an intention whose window is open on this date, and
      // which has not fired today, fires. `Counterpart` never calls `fire()` for
      // an adapter — the host does, so the seeder does.
      for (const [key, intent] of intentionIds) {
        if (intent.dueOn === null) continue;
        const out = c.prospective.fire({
          memoryId: intent.id,
          windowKey: intent.windowKey,
          at: day.date,
          day: livedDay,
          sessionId: `${day.session}:${key}`,
        });
        if (out.fired) fired += 1;
      }

      await c.sessionEnd({ date: day.date, at: day.date, budgetBytes });
    }

    // Anything still waiting gets an explicit `armed` row, so "pending" is a
    // record in the store rather than the absence of one (scar §2.4).
    for (const [, intent] of intentionIds) {
      if (intent.dueOn === null) continue;
      const state = c.prospective.deriveFor(intent.id, DAYS[DAYS.length - 1]?.date ?? "2026-07-10");
      if (state === null) continue;
      const out = c.prospective.arm(intent.id, intent.windowKey);
      if (out.state === "armed") armed += 1;
    }

    // One last re-render, so the wake in the screenshots is the newest one.
    c.rebrief({ budgetBytes, at: DAYS[DAYS.length - 1]?.date ?? "2026-07-10" });

    const revisionOutcomes: Record<string, number> = {};
    for (const r of revisions) {
      const key = `${r.path}:${r.reason}`;
      revisionOutcomes[key] = (revisionOutcomes[key] ?? 0) + 1;
    }
    return { ...measure(c, dir, { fired, pending: armed }), refusals, revisionOutcomes };
  } finally {
    c.close();
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ---------------------------------------------------------------------------
// Measurement — read back out of the store, never counted as we go
// ---------------------------------------------------------------------------

function measure(
  c: Counterpart,
  dir: string,
  prospective: { fired: number; pending: number },
): Omit<SeedReport, "refusals" | "revisionOutcomes"> {
  const day = c.store.livedDay();
  const byKind: Record<Kind, number> = { self: 0, person: 0, entity: 0, skill: 0, place: 0, fact: 0 };
  const byBand: Record<string, number> = { episodic: 0, semantic: 0, identity: 0 };
  let memories = 0;
  let episodes = 0;
  let beliefs = 0;
  let currentState = 0;
  let entities = 0;
  let edges = 0;

  for (const id of c.store.list()) {
    const row = c.store.row(id);
    if (row === undefined) continue;
    if (row.type === "episode") {
      episodes += 1;
      continue;
    }
    if (row.type === "schema") {
      const role = c.schemas.element(id)?.role ?? null;
      if (role === "belief") beliefs += 1;
      else if (role === "current-state") currentState += 1;
      else entities += 1;
      continue;
    }
    memories += 1;
    byKind[row.kind as Kind] = (byKind[row.kind as Kind] ?? 0) + 1;
    try {
      const b = band(c.store.physicsOf(id), day);
      byBand[b] = (byBand[b] ?? 0) + 1;
    } catch {
      /* a row whose physics will not read is counted in `memories` only */
    }
    edges += c.store.edgesFrom(id).length;
  }

  const enumeration = c.self.enumerate(day);
  const pressure = c.store.eventLog({ name: "revision.pressure", limit: 10_000 });
  // Superseded rows are ARCHIVED, so both counts read the archived set too — a
  // revision counted only over live rows counts zero, always.
  let revised = 0;
  let replaced = 0;
  for (const id of c.store.list({ type: "schema", archived: true })) {
    const row = c.store.row(id);
    if (row?.superseded_by == null) continue;
    const role = c.schemas.element(id)?.role ?? null;
    if (role === "belief") revised += 1;
    else if (role === "current-state") replaced += 1;
  }

  return {
    dir,
    mode: "rich",
    livedDays: day,
    memories,
    memoriesByKind: byKind,
    memoriesByBand: byBand,
    entities,
    beliefs,
    currentState,
    protectedElements: enumeration.protected.length,
    identityElements: enumeration.identity.length,
    episodes,
    chapters: episodes,
    contestedBeliefs: new Set(pressure.map((p) => p.ref).filter((r) => r !== null)).size,
    revisedBeliefs: revised,
    replacedCurrentState: replaced,
    pressureIncrements: pressure.length,
    pruned: c.store.eventLog({ name: "memory.pruned", limit: 10_000 }).length,
    merged: c.store.eventLog({ name: "memory.merged", limit: 10_000 }).length,
    promoted: c.store.eventLog({ name: "band.promoted", limit: 10_000 }).length,
    edges,
    recallDecisions: c.store.eventLog({ name: "recall.decision", limit: 10_000 }).length,
    intentionsFired: prospective.fired,
    intentionsPending: prospective.pending,
    briefingBytes: c.wake().bytes,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): string {
  return [
    "seed — build the synthetic demo store every launch screenshot comes from",
    "",
    "  bun run tools/demo/seed.ts --dir <path>    seed into an explicit directory",
    "  bun run tools/demo/seed.ts --temp          seed into a fresh temp dir and print it",
    "  bun run tools/demo/seed.ts --temp --empty  an initialized, empty store",
    "",
    "There is NO default directory. ~/.counterparts, ~/.bansai, ~/.claude-engram,",
    "~/.memory-ab, ~/counterparts-parallel-run and ~/counterparts-backups are refused",
    "by name, and so is any directory that already holds a store.",
    "",
    "Render the views against what it built:",
    "  COUNTERPARTS_DATA_DIR=<path> bun run src/adapters/dashboard/bin/dashboard.ts status \\",
    "    --no-colour --width 100",
  ].join("\n");
}

export async function main(argv: readonly string[]): Promise<number> {
  let dirFlag: string | null = null;
  let temp = false;
  let empty = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dir") {
      const next = argv[i + 1];
      if (next === undefined) {
        process.stderr.write("--dir needs a path\n");
        return 2;
      }
      dirFlag = next;
      i += 1;
    } else if (token === "--temp") temp = true;
    else if (token === "--empty") empty = true;
    else if (token === "--help" || token === "-h") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    } else {
      process.stderr.write(`unknown flag ${String(token)}\n${usage()}\n`);
      return 2;
    }
  }

  if (dirFlag === null && !temp) {
    process.stderr.write(`${usage()}\n\none of --dir or --temp is required.\n`);
    return 2;
  }
  // NOT resolved against the cwd: `--dir demo-store` must reach the guard as the
  // relative path it is and be refused there, so the README's "there is no
  // default directory" is true of the CLI too and not only of the library.
  const dir = dirFlag !== null ? dirFlag : mkdtempSync(join(tmpdir(), "counterparts-demo-"));

  try {
    const report = empty ? seedEmpty({ dir }) : await seedDemo({ dir });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`\nseeded ${report.mode} store at ${report.dir}\n`);
    if (report.refusals.length > 0) {
      process.stderr.write(`\n${report.refusals.length} REFUSED deposits:\n`);
      for (const r of report.refusals) process.stderr.write(`  ${r}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof DemoTargetRefused) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

if (import.meta.main) {
  // Rule 1, mechanized one level down: nothing here reads the environment for a
  // directory, and with the explicit-dir guard armed nothing UNDER here can fall
  // back to `~/.counterparts/store` either — a door that forgot its `dir` is
  // refused by the store instead of opening the owner's memory (I21). Set only
  // on the CLI path: as a library, the caller's process owns its environment.
  process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
  process.exit(await main(process.argv.slice(2)));
}

/** Re-exported so the test can name the same tunables the seeder reasoned with. */
export { PHYSICS };
