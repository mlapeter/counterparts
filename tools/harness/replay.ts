/**
 * PHYSICS-ONLY REPLAY: the recorded acts of a store, fed one lived day at a
 * time into a fresh temp store on a fed clock, with no model in the seat.
 *
 * The harness is a host the way Claude Code is one: it opens a Counterpart
 * through the package's own entry (`src/core/counterpart.ts`, the `.` export)
 * and drives the boundary the way the adapters do (`sessionEnd({date})`, the
 * sweep skipped by name as the night worker does). It imports nothing else
 * from `src/` (`test/harness-imports.test.ts`), so it also proves the public
 * seams are enough to be a host.
 *
 * Per lived day, in the order live had it: the boundary runs first (its clock
 * phase moves the day, and the day's once-a-day phases run on what the days
 * before left), then that day's acts land. Day 0 has no boundary: the store is
 * born on it.
 *
 * The record it returns holds ids, counts and days. Never a body, a title, a
 * feeling's words.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { Counterpart } from "../../src/core/counterpart.js";

import { extract, readOutcomeAt, underLiveRoot } from "./source.js";
import type { Act, Extracted, RecordedOutcome } from "./source.js";

export interface ReplayOptions {
  /** A snapshot COPY, never under ~/.counterparts. */
  readonly source: string;
  /** Pin the recorded awake returns, or let physics derive them from the uses (default). */
  readonly returns?: "derived" | "recorded";
  /** Stop after this lived day (inclusive). Default: the source's last. */
  readonly throughDay?: number;
  /** The host's wake ceiling; the live Claude Code config reports 9,000. */
  readonly budgetBytes?: number;
  /** Parent for the temp store. Default: the OS temp dir. */
  readonly workRoot?: string;
  /** Keep the replayed store (for a look, or to branch an A/B from). Default: removed. */
  readonly keep?: boolean;
  /** How many promotion days the early-core table covers. Default 10. */
  readonly earlyDays?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly onDay?: (day: number, total: number) => void;
}

export interface DayLine {
  readonly day: number;
  readonly date: string;
  /** Live memories in the replay at the end of the day: the pool a recall drew from. */
  readonly alive: number;
  readonly identity: number;
  readonly births: number;
  readonly uses: { readonly fed: number; readonly credited: number; readonly returns: number };
  readonly nightReturns: { readonly fed: number; readonly counted: number };
  readonly settles: { readonly fed: number; readonly ok: number };
  readonly promoted: number;
  /** Phases that ran out of budget in the day's boundary (their cursors resume the next day, as live's). */
  readonly budgetExhausted: readonly string[];
}

export interface EarlyPromotion {
  readonly id: string;
  readonly day: number;
  readonly lane: string | null;
  readonly birthDay: number;
  /** Its place in birth order: 1 = the first memory the store ever made. */
  readonly birthRank: number;
  /** Returns that count toward the core behind it at promotion (weight > 0, not a dream's): count, distinct days, distinct sessions. */
  readonly returns: number;
  readonly returnDays: number;
  readonly returnSessions: number;
  /** Those returns as `source@day`, oldest first. */
  readonly sources: string;
  /** Live memories on its promotion day. */
  readonly pool: number;
  /** Was it promoted in the recorded run too, and on which day. */
  readonly recordedDay: number | null;
}

export interface Fidelity {
  readonly uses: { readonly recorded: number; readonly replayed: number; readonly exact: number; readonly short: number; readonly over: number; readonly memories: number };
  /** Returns by id@day, per source: rule changes show here (ratings and drewOn credit differently than they did). */
  readonly awakeReturns: Readonly<Record<string, { readonly recorded: number; readonly replayed: number; readonly matched: number }>>;
  readonly promotions: { readonly recorded: number; readonly replayed: number; readonly matched: number; readonly sameDay: number };
  /** Live rows, recorded band → replayed band. */
  readonly bands: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly archived: { readonly recorded: number; readonly replayed: number; readonly both: number };
}

export interface RunRecord {
  readonly harness: "physics-only";
  readonly ranAt: string;
  readonly elapsedMs: number;
  readonly source: { readonly schemaVersion: number; readonly livedDay: number; readonly eventsFrom: number; readonly memories: number; readonly chapterCopiesSkipped: number };
  readonly mode: { readonly returns: "derived" | "recorded"; readonly throughDay: number; readonly budgetBytes: number };
  readonly gaps: Extracted["gaps"] & {
    readonly refused: Readonly<Record<string, number>>;
    readonly clockMismatches: number;
  };
  readonly days: readonly DayLine[];
  readonly early: readonly EarlyPromotion[];
  /** Only meaningful when the replay ran to the source's last day. */
  readonly fidelity: Fidelity | null;
  /** Where the replayed store was kept, when `keep` asked. */
  readonly keptAt: string | null;
}

export class ReplayError extends Error {
  readonly code: string;
  constructor(code: string, detail = "") {
    super(detail.length > 0 ? `${code}: ${detail}` : code);
    this.name = "ReplayError";
    this.code = code;
  }
}

/** Midday UTC on a calendar date: a day's instant that reads back as the same date. */
export function middayUtc(date: string): number {
  const at = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(at)) throw new ReplayError("BAD_DATE", date);
  return at;
}

const DATABASE_FILE = "counterparts.sqlite";


export async function runPhysicsReplay(opts: ReplayOptions): Promise<RunRecord> {
  const started = Date.now();
  const env = opts.env ?? process.env;
  const preset = env["COUNTERPARTS_DATA_DIR"];
  if (preset !== undefined && preset.trim().length > 0) throw new ReplayError("DATA_DIR_PRESET", "the harness makes its own store; unset COUNTERPARTS_DATA_DIR");

  for (const [name, v] of [["throughDay", opts.throughDay], ["earlyDays", opts.earlyDays]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new ReplayError("BAD_OPTION", `${name} must be a whole number of days, not ${String(v)}`);
  }
  const src = extract(opts.source, { returns: opts.returns ?? "derived", env });
  const last = src.days.length - 1;
  const through = Math.min(opts.throughDay ?? last, last);
  if (through < 0) throw new ReplayError("NOTHING_TO_REPLAY");
  const budgetBytes = opts.budgetBytes ?? 9_000;

  // Checked before anything is made: a work root under the live root must not
  // so much as create a folder there.
  const root = resolve(opts.workRoot ?? tmpdir());
  if (underLiveRoot(root, env)) throw new ReplayError("TARGET_IS_LIVE", root);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(realpathSync(root), "counterparts-harness-"));
  if (underLiveRoot(dir, env)) {
    rmSync(dir, { recursive: true, force: true });
    throw new ReplayError("TARGET_IS_LIVE", dir);
  }

  // The replayed store holds the record's words: it is removed on every way
  // out, a throw included, unless `keep` asked for it.
  try {
    return await replayInto(dir, src, opts, through, budgetBytes, started);
  } finally {
    if (opts.keep !== true) rmSync(dir, { recursive: true, force: true });
  }
}

async function replayInto(
  dir: string,
  src: Extracted,
  opts: ReplayOptions,
  through: number,
  budgetBytes: number,
  started: number,
): Promise<RunRecord> {
  const last = src.days.length - 1;
  let clock = middayUtc(src.days[0]!.date);
  const c = Counterpart.open({
    dir,
    owner: true,
    budgetBytes,
    now: () => clock,
    timeZone: "UTC",
    // The source's whole span plus the default slack: nothing the record is
    // read back from ages out mid-run.
    retentionDays: src.days.length + 90,
  });
  const peek = new Database(join(dir, DATABASE_FILE), { readonly: true });

  const refused: Record<string, number> = {};
  const refuse = (what: string, err: unknown): void => {
    const code = (err as { code?: unknown }).code;
    const key = `${what}:${typeof code === "string" ? code : err instanceof Error ? err.name : "unknown"}`;
    refused[key] = (refused[key] ?? 0) + 1;
  };
  let clockMismatches = 0;
  const days: DayLine[] = [];
  const birthRank = new Map<string, number>();
  const birthDay = new Map<string, number>();

  try {
    for (const rec of src.days.slice(0, through + 1)) {
      clock = middayUtc(rec.date);
      let promoted = 0;
      const budgetExhausted: string[] = [];
      if (rec.day > 0) {
        // One boundary a day. Live ran many, but a once-a-day phase marks its
        // day done even when its budget ran out (its cursor resumes the next
        // day), so the later boundaries of a day ran the clock alone.
        const report = await c.sessionEnd({ date: rec.date, sweep: { skipped: "not-opted-in" } });
        promoted = report.cycle.promoted.length;
        for (const p of report.cycle.phases) if (p.budgetExhausted) budgetExhausted.push(p.phase);
      }
      if (c.store.livedDay() !== rec.day) clockMismatches += 1;
      const tally = { births: 0, usesFed: 0, credited: 0, returns: 0, nightFed: 0, nightCounted: 0, settlesFed: 0, settlesOk: 0 };
      for (const act of rec.acts) apply(c, act, rec.day, tally, refuse, birthRank, birthDay);
      days.push({
        day: rec.day,
        date: rec.date,
        alive: count(peek, "SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND archived = 0"),
        identity: count(peek, "SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND archived = 0 AND band = 'identity'"),
        births: tally.births,
        uses: { fed: tally.usesFed, credited: tally.credited, returns: tally.returns },
        nightReturns: { fed: tally.nightFed, counted: tally.nightCounted },
        settles: { fed: tally.settlesFed, ok: tally.settlesOk },
        promoted,
        budgetExhausted,
      });
      opts.onDay?.(rec.day, through);
    }
    // One closing boundary on the day after, so the last day's acts are
    // consolidated as live's next morning would.
    const nextDate = new Date(middayUtc(src.days[through]!.date) + 86_400_000).toISOString().slice(0, 10);
    clock = middayUtc(nextDate);
    await c.sessionEnd({ date: nextDate, sweep: { skipped: "not-opted-in" } });
  } finally {
    peek.close();
    c.close();
  }

  const replayed = readOutcomeAt(join(dir, DATABASE_FILE));
  const early = earlyTable(join(dir, DATABASE_FILE), days, birthRank, birthDay, src.outcome, opts.earlyDays ?? 10);
  const fidelity = through === last ? compare(src.outcome, replayed) : null;

  return {
    harness: "physics-only",
    ranAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started,
    source: {
      schemaVersion: src.schemaVersion,
      livedDay: src.livedDay,
      eventsFrom: src.eventsFrom,
      memories: src.memoriesReplayed,
      chapterCopiesSkipped: src.chapterCopiesSkipped,
    },
    mode: { returns: opts.returns ?? "derived", throughDay: through, budgetBytes },
    gaps: { ...src.gaps, refused, clockMismatches },
    days,
    early,
    fidelity,
    keptAt: opts.keep === true ? dir : null,
  };
}

interface Tally {
  births: number;
  usesFed: number;
  credited: number;
  returns: number;
  nightFed: number;
  nightCounted: number;
  settlesFed: number;
  settlesOk: number;
}

function apply(
  c: Counterpart,
  act: Act,
  day: number,
  t: Tally,
  refuse: (what: string, err: unknown) => void,
  birthRank: Map<string, number>,
  birthDay: Map<string, number>,
): void {
  try {
    switch (act.kind) {
      case "birth": {
        c.store.put({
          id: act.id,
          type: "memory",
          kind: act.memKind as Parameters<Counterpart["store"]["put"]>[0]["kind"],
          body: act.body,
          ...(act.title === null ? {} : { title: act.title }),
          learnedOn: act.learnedOn,
          salience: {
            novelty: act.salience.novelty,
            relevance: act.salience.relevance,
            emotional: act.salience.emotional,
            predictive: act.salience.predictive,
            ...(act.salience.claimed === null ? {} : { claimed: act.salience.claimed }),
          },
          physics: { birthDay: day, lastUsedDay: day },
          ...(act.source === null ? {} : { source: act.source as NonNullable<Parameters<Counterpart["store"]["put"]>[0]["source"]> }),
          ...(act.about === null ? {} : { about: act.about as NonNullable<Parameters<Counterpart["store"]["put"]>[0]["about"]> }),
          ...(act.session === null ? {} : { origin: { session: act.session } }),
        });
        t.births += 1;
        birthRank.set(act.id, birthRank.size + 1);
        birthDay.set(act.id, day);
        return;
      }
      case "about":
        c.store.setAbout(act.id, act.mark as Parameters<Counterpart["store"]["setAbout"]>[1], {
          by: act.by as Parameters<Counterpart["store"]["setAbout"]>[2]["by"],
          day,
        });
        return;
      case "feeling":
        c.store.addFeelings(
          act.id,
          [
            {
              whose: act.whose,
              core: act.core,
              emotion: act.emotion,
              ...(act.otherWord === null ? {} : { otherWord: act.otherWord }),
              strength: act.strength,
              ...(act.valence === null ? {} : { valence: act.valence }),
              carriedBy: act.carriedBy,
            },
          ],
          {
            provenance: [{ source: act.source, recordedLater: act.recordedLater, createdAt: act.createdAt, recordedDay: day }],
          },
        );
        return;
      case "use": {
        t.usesFed += 1;
        const out = c.store.reinforce(act.id, day, act.tier, { ...(act.cued ? { cued: true } : {}), session: act.session });
        if (out.credited) t.credited += 1;
        if (out.ret?.counted === true) t.returns += 1;
        return;
      }
      case "night-return": {
        t.nightFed += 1;
        const out =
          act.source === "dream"
            ? c.store.replayReturn(act.id, day, act.dreamId ?? "drm_replayed")
            : c.store.reflectReturn(act.id, day, { session: act.session });
        if (out.counted) t.nightCounted += 1;
        return;
      }
      case "settle": {
        t.settlesFed += 1;
        const out = c.settleContradiction({
          holds: act.holds,
          over: act.over,
          how: act.how,
          actor: act.actor as Parameters<Counterpart["settleContradiction"]>[0]["actor"],
          actorId: act.actorId,
          day,
        });
        if (out.ok) t.settlesOk += 1;
        else refuse("settle", { code: out.reason });
        return;
      }
      case "merge":
        // A merge as the record kept it before 2026-10-11: the original's
        // returns and mark carried into the merged memory, the original archived.
        if (act.into !== null) c.store.carryInto(act.id, act.into);
        c.store.archive(act.id, "dream-merge");
        return;
    }
  } catch (err) {
    refuse(act.kind, err);
  }
}

function count(db: Database, sql: string): number {
  return Number((db.query(sql).get() as { n: number } | null)?.n ?? 0);
}

function earlyTable(
  path: string,
  days: readonly DayLine[],
  birthRank: ReadonlyMap<string, number>,
  birthDay: ReadonlyMap<string, number>,
  recorded: RecordedOutcome,
  span: number,
): EarlyPromotion[] {
  const db = new Database(path, { readonly: true });
  try {
    const poolOn = new Map(days.map((d) => [d.day, d.alive]));
    const recordedDay = new Map<string, number>();
    for (const p of recorded.promotions) if (!recordedDay.has(p.id)) recordedDay.set(p.id, p.day);
    const first = days[0]?.day ?? 0;
    const rows = db
      .query("SELECT memory_id, day, lane FROM core_events WHERE action = 'promoted' AND day <= ? ORDER BY seq")
      .all(first + span) as { memory_id: string; day: number; lane: string | null }[];
    const evidence = "memory_id = ? AND day <= ? AND source <> 'dream' AND weight > 0";
    const returns = db.query(`SELECT COUNT(*) AS n, COUNT(DISTINCT day) AS d, COUNT(DISTINCT session) AS s FROM returns WHERE ${evidence}`);
    const sources = db.query(`SELECT group_concat(source || '@' || day, ',') AS s FROM (SELECT source, day FROM returns WHERE ${evidence} ORDER BY day, at)`);
    return rows.map((r) => {
      const ret = returns.get(r.memory_id, r.day) as { n: number; d: number; s: number };
      return {
        id: r.memory_id,
        day: r.day,
        lane: r.lane,
        birthDay: birthDay.get(r.memory_id) ?? -1,
        birthRank: birthRank.get(r.memory_id) ?? -1,
        returns: ret.n,
        returnDays: ret.d,
        returnSessions: ret.s,
        sources: String((sources.get(r.memory_id, r.day) as { s: string | null } | null)?.s ?? ""),
        // A promotion on day d is consolidated at d's boundary, before d's acts:
        // the pool it won against is the previous day's.
        pool: poolOn.get(r.day - 1) ?? poolOn.get(r.day) ?? 0,
        recordedDay: recordedDay.get(r.memory_id) ?? null,
      };
    });
  } finally {
    db.close();
  }
}

function compare(rec: RecordedOutcome, rep: RecordedOutcome): Fidelity {
  let exact = 0;
  let short = 0;
  let over = 0;
  let recordedUses = 0;
  let replayedUses = 0;
  for (const [id, u] of rec.uses) {
    const r = rep.uses.get(id) ?? 0;
    recordedUses += u;
    replayedUses += r;
    if (Math.abs(r - u) < 1e-6) exact += 1;
    else if (r < u) short += 1;
    else over += 1;
  }
  const key = (x: { id: string; day: number }): string => `${x.id}@${String(x.day)}`;
  const awakeReturns: Record<string, { recorded: number; replayed: number; matched: number }> = {};
  for (const source of new Set([...rec.awakeReturns, ...rep.awakeReturns].map((x) => x.source))) {
    const recRet = new Set(rec.awakeReturns.filter((x) => x.source === source).map(key));
    const repRet = new Set(rep.awakeReturns.filter((x) => x.source === source).map(key));
    awakeReturns[source] = { recorded: recRet.size, replayed: repRet.size, matched: [...recRet].filter((k) => repRet.has(k)).length };
  }
  const recProm = new Map<string, number>();
  for (const p of rec.promotions) if (!recProm.has(p.id)) recProm.set(p.id, p.day);
  const repProm = new Map<string, number>();
  for (const p of rep.promotions) if (!repProm.has(p.id)) repProm.set(p.id, p.day);
  const bands: Record<string, Record<string, number>> = {};
  for (const [id, b] of rec.bands) {
    const to = rep.bands.get(id) ?? (rep.archived.has(id) ? "archived" : "missing");
    bands[b] ??= {};
    bands[b][to] = (bands[b][to] ?? 0) + 1;
  }
  return {
    uses: { recorded: round(recordedUses), replayed: round(replayedUses), exact, short, over, memories: rec.uses.size },
    awakeReturns,
    promotions: {
      recorded: recProm.size,
      replayed: repProm.size,
      matched: [...recProm.keys()].filter((id) => repProm.has(id)).length,
      sameDay: [...recProm].filter(([id, d]) => repProm.get(id) === d).length,
    },
    bands,
    archived: {
      recorded: rec.archived.size,
      replayed: rep.archived.size,
      both: [...rec.archived].filter((id) => rep.archived.has(id)).length,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
