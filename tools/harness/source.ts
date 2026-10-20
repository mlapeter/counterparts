/**
 * The RECORD a replay reads: a snapshot copy of a Counterparts store, opened
 * read-only, turned into a stream of lived days of memory-facing acts.
 *
 * What a physics-only replay feeds is ACTS, never outputs: a memory's birth, an
 * about-mark, a feeling, a use, a rating, a night's chosen return, a settle,
 * a merge. Bands, awake returns, promotions and decay are what physics makes of
 * those acts, so they are the comparison targets (`replay.ts`), not inputs.
 *
 * Text crosses from here into the replay's temp store (a memory has to say
 * something to be indexed and recalled) and nowhere else: nothing in this file
 * writes a file, and the run record carries ids, counts and days only.
 *
 * Where each act comes from, and what the record cannot give back:
 *
 *   - births: `memories` (`birth_day`, salience columns, kind, source, about,
 *     origin_session). The body is the FIRST version's when `versions` kept
 *     one, else the row's own; salience is the row's current value, which a
 *     dream may have revised since (a named gap).
 *   - about-marks: `core_events` action `about`, on their day; a memory's mark
 *     at birth is the earliest event's "was", or its current mark when no event
 *     changed it (a mark given at birth writes no event).
 *   - feelings: `feelings`, on `recorded_day`.
 *   - uses: the `recall.credit` rows (session-level; `ids` capped at 64 per row,
 *     `idsTotal` says how many were cut), `drewOn` credits, and `recall.rated`.
 *     Expanded and quoted ids are `referenced` (quoted is cued, as live);
 *     drewOn is `engaged`; a rating is its score's tier. Other credit paths
 *     (recall surfacing, schemas mentions, the self page citing) write no row:
 *     the replay's per-memory use diff measures what they carried.
 *   - recorded awake returns: `returns` rows of the awake class, for the
 *     `--returns recorded` mode only, which pins them instead of deriving them.
 *   - night returns: `returns` rows sourced `dream` / `reflection` (the seat's
 *     own choice of what to revisit, so an act here).
 *   - settles: `contradictions` settled, with the actor from
 *     `contradiction_settles`, on `settled_day`.
 *   - merges: memories archived `dream-merge`, on their version's day.
 *
 * Events prune after the store's retention (90 lived days by default), so a
 * source older than that has lost its early use rows; `RecordedStore` reports
 * the first lived day its event log still covers.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// bun:sqlite only: the harness is a dev tool run with bun (`tools/harness/README.md`).
import { Database } from "bun:sqlite";

export type UseTier = "referenced" | "engaged" | "useful" | "ontopic" | "shown";

export interface BirthAct {
  readonly kind: "birth";
  readonly id: string;
  readonly memKind: string;
  readonly title: string | null;
  readonly body: string;
  readonly salience: { novelty: number | null; relevance: number; emotional: number; predictive: number; claimed: number | null };
  readonly source: string | null;
  readonly about: string | null;
  readonly session: string | null;
  readonly learnedOn: string;
  readonly createdAt: number | null;
}

export interface AboutAct {
  readonly kind: "about";
  readonly id: string;
  readonly mark: string;
  readonly by: string;
}

export interface FeelingAct {
  readonly kind: "feeling";
  readonly id: string;
  readonly whose: string;
  readonly core: string;
  readonly emotion: string;
  readonly otherWord: string | null;
  readonly strength: number;
  readonly valence: number | null;
  readonly carriedBy: string;
  readonly source: string | null;
  readonly recordedLater: string | null;
  readonly createdAt: number;
}

export interface UseAct {
  readonly kind: "use";
  readonly id: string;
  readonly tier: UseTier;
  readonly cued: boolean;
  readonly session: string | null;
  /** Where the record had it: `credit` (a boundary's expansions/quotes), `drewOn`, `rated`, `return` (a pinned awake return). */
  readonly from: "credit" | "drewOn" | "rated" | "return";
}

export interface NightReturnAct {
  readonly kind: "night-return";
  readonly id: string;
  readonly source: "dream" | "reflection";
  readonly dreamId: string | null;
  readonly session: string | null;
}

export interface SettleAct {
  readonly kind: "settle";
  readonly pair: string;
  readonly how: string;
  readonly holds: string;
  readonly over: string;
  readonly actor: string;
  readonly actorId: string | null;
}

export interface MergeAct {
  readonly kind: "merge";
  readonly id: string;
  /** The memory it was merged into, when that one is replayed too: the merge carries returns into it, as live's does. */
  readonly into: string | null;
}

export type Act = BirthAct | AboutAct | FeelingAct | UseAct | NightReturnAct | SettleAct | MergeAct;

/** One lived day of the record: its calendar date and its acts, in feed order. */
export interface RecordedDay {
  readonly day: number;
  readonly date: string;
  readonly acts: readonly Act[];
}

/** What the record says happened, for the replay to be compared against. Ids and numbers only. */
export interface RecordedOutcome {
  /** memory id → its recorded `uses` (the aggregate column). */
  readonly uses: ReadonlyMap<string, number>;
  /** memory id → band at the snapshot (`episodic` / `semantic` / `identity`), live rows only. */
  readonly bands: ReadonlyMap<string, string>;
  /** Promotions into the core: id, lived day, lane. */
  readonly promotions: readonly { id: string; day: number; lane: string | null }[];
  /** Awake-class returns (source, day) per id. */
  readonly awakeReturns: readonly { id: string; day: number; source: string; weight: number }[];
  readonly archived: ReadonlySet<string>;
}

export interface SourceGaps {
  /** Ids a `recall.credit` row cut at its cap (`idsTotal - ids.length`, summed). */
  readonly creditIdsCut: number;
  /** Acts naming an id that is not a replayed memory (an episode, a place, a removed row). */
  readonly actsOnUnknownIds: number;
  /** Uses dated before their memory's birth day (dropped: physics refuses them anyway). */
  readonly usesBeforeBirth: number;
  /** Revised births whose body is the current row's because no first version was kept. */
  readonly bodiesFromCurrentRow: number;
  /** Merges with no version day to date them (left alive). */
  readonly mergesUndated: number;
  /** Lived days with no sleep-cycle row to date them, dated by what was learned on them or as the day after. */
  readonly daysDatedByFallback: number;
}

export interface Extracted {
  readonly days: readonly RecordedDay[];
  readonly outcome: RecordedOutcome;
  readonly gaps: SourceGaps;
  readonly schemaVersion: number;
  readonly livedDay: number;
  /** The first lived day the event log still holds a row for (0 = complete). */
  readonly eventsFrom: number;
  readonly memoriesReplayed: number;
  /** Chapter copies (`source = 'episode'`) left out with the episodes they copy. */
  readonly chapterCopiesSkipped: number;
}

export class SourceError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "SourceError";
    this.code = code;
  }
}

/** The owner's live data root. Nothing under it is ever a source or a target. */
export function liveRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env["HOME"] ?? homedir(), ".counterparts");
}

export function underLiveRoot(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const real = realish(path);
  const realRoot = realish(liveRoot(env));
  return real === realRoot || real.startsWith(realRoot + "/");
}

/**
 * A path with its symlinks resolved, including one that does not exist yet:
 * the nearest existing ancestor is resolved and the rest appended, so a
 * folder about to be made is compared where it would land (macOS's `/var` is
 * `/private/var`).
 */
function realish(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) break;
    tail.unshift(basename(head));
    head = up;
  }
  return join(existsSync(head) ? realpathSync(head) : head, ...tail);
}

/** The awake-class return sources: the ones a session's own use earns. */
export const AWAKE_RETURN_SOURCES = ["awake", "engaged", "ontopic", "shown", "legacy"] as const;

/**
 * The rows a replay re-lives: memories, not the episodes' chapter copies. A
 * copy is archived when its episode regrows (the adapter's night, not physics),
 * so fed alone physics prunes it instead; it is read with its episode in run 2.
 */
const REPLAYED = "type = 'memory' AND COALESCE(source, '') <> 'episode'";

const RATED_TIER: Record<number, UseTier | undefined> = { 1: "ontopic", 2: "useful", 3: "referenced" };

const RETURN_TIER: Record<string, UseTier> = {
  awake: "referenced",
  engaged: "engaged",
  ontopic: "ontopic",
  shown: "shown",
  legacy: "referenced",
};

type Row = Record<string, unknown>;

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parse(payload: unknown): Row {
  if (typeof payload !== "string") return {};
  try {
    const v = JSON.parse(payload) as unknown;
    return v !== null && typeof v === "object" ? (v as Row) : {};
  } catch {
    return {};
  }
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** A mark as the about event's reason writes it: `<mark> (was <before>)…`. */
export function parseAboutReason(reason: string): { mark: string; was: string } | null {
  const m = /^(\S+) \(was ([^)]+)\)/.exec(reason);
  return m === null ? null : { mark: m[1]!, was: m[2]! };
}

export interface ExtractOptions {
  /** Pin the recorded awake returns (`recorded`) instead of letting physics derive them (`derived`, the default). */
  readonly returns?: "derived" | "recorded";
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Read a snapshot copy. Refuses anything under the owner's live root: copy the
 * snapshot aside first (`tools/harness/README.md`), so the live store is never
 * one argument away.
 */
export function extract(sourcePath: string, opts: ExtractOptions = {}): Extracted {
  const path = resolve(sourcePath);
  if (!existsSync(path)) throw new SourceError("SOURCE_MISSING", path);
  if (underLiveRoot(path, opts.env)) throw new SourceError("SOURCE_IS_LIVE", "copy the snapshot out of ~/.counterparts first");
  const db = new Database(path, { readonly: true });
  try {
    return read(db, opts.returns ?? "derived");
  } finally {
    db.close();
  }
}

function read(db: Database, returnsMode: "derived" | "recorded"): Extracted {
  const metaQuery = db.query("SELECT value FROM meta WHERE key = ?");
  const meta = (key: string): string | null => str((metaQuery.get(key) as Row | null)?.["value"]);
  const schemaVersion = Number(meta("schemaVersion") ?? "0");
  if (schemaVersion < 13) throw new SourceError("SOURCE_SCHEMA", `schema v${String(schemaVersion)}; the harness reads v13 or later`);
  const livedDay = Number(meta("livedDay") ?? "0");
  const created = meta("store.created");
  if (created === null) throw new SourceError("SOURCE_NO_CREATED", "meta store.created is missing");

  // DAY → DATE. Day 0 is the creation date; every later day is the date its
  // first sleep cycle carried (the clock phase advances on a new date).
  const dateOf = new Map<number, string>([[0, created]]);
  for (const r of db.query("SELECT day, MIN(json_extract(payload, '$.date')) AS date FROM events WHERE name = 'sleep.cycle' GROUP BY day").all() as Row[]) {
    const d = str(r["date"]);
    if (d !== null) dateOf.set(num(r["day"]), d);
  }
  const eventsFrom = num((db.query("SELECT MIN(day) AS d FROM events").get() as Row)["d"] ?? 0);

  // Each act carries the instant the record gave it, so a day's acts replay in
  // the order live had them (a dream's returns land between that day's uses,
  // and which of two same-day returns counts depends on which came first).
  const acts = new Map<number, { act: Act; at: number }[]>();
  const push = (day: number, act: Act, at: unknown): void => {
    const list = acts.get(day) ?? [];
    list.push({ act, at: typeof at === "number" ? at : Number(at ?? 0) || 0 });
    acts.set(day, list);
  };

  let bodiesFromCurrentRow = 0;
  let actsOnUnknownIds = 0;
  let usesBeforeBirth = 0;
  let mergesUndated = 0;
  let creditIdsCut = 0;
  let daysDatedByFallback = 0;

  // BIRTHS. Memories only (`REPLAYED`): episodes, places and the episodes'
  // chapter copies are the night's and the adapter's, with their own regrow /
  // clear lifecycle (run 2, if the promotion diff asks for them).
  const born = new Map<string, number>();
  const bornAt = new Map<string, number>();
  const firstVersion = db.query("SELECT title, body FROM versions WHERE memory_id = ? ORDER BY seq ASC LIMIT 1");
  const firstAbout = db.query("SELECT reason FROM core_events WHERE memory_id = ? AND action = 'about' ORDER BY seq ASC LIMIT 1");
  const memRows = db
    .query(
      `SELECT id, kind, birth_day, novelty, relevance, emotional, predictive, claimed, source, about,
              origin_session, learned_on, created_at, title, body, revision
         FROM memories WHERE ${REPLAYED} ORDER BY birth_day, COALESCE(created_at, 0), id`,
    )
    .all() as Row[];
  for (const r of memRows) {
    const id = String(r["id"]);
    const day = num(r["birth_day"]);
    born.set(id, day);
    if (r["created_at"] !== null) bornAt.set(id, num(r["created_at"]));
    const v = firstVersion.get(id) as Row | null;
    if (v === null && num(r["revision"]) > 0) bodiesFromCurrentRow += 1;
    const fa = firstAbout.get(id) as Row | null;
    const parsed = fa === null ? null : parseAboutReason(String(fa["reason"]));
    const about = parsed === null ? str(r["about"]) : parsed.was === "unmarked" ? null : parsed.was;
    push(
      day,
      {
      kind: "birth",
      id,
      memKind: String(r["kind"]),
      title: v === null ? str(r["title"]) : str(v["title"]),
      body: String(v === null ? r["body"] : v["body"]),
      salience: {
        novelty: r["novelty"] === null ? null : num(r["novelty"]),
        relevance: num(r["relevance"]),
        emotional: num(r["emotional"]),
        predictive: num(r["predictive"]),
        claimed: r["claimed"] === null ? null : num(r["claimed"]),
      },
      source: str(r["source"]),
      about,
      session: str(r["origin_session"]),
      learnedOn: String(r["learned_on"]),
      createdAt: r["created_at"] === null ? null : num(r["created_at"]),
      },
      r["created_at"],
    );
  }

  const known = (id: string): boolean => born.has(id);
  /** A use the replay can apply: a known id on or after its birth day. */
  const usable = (id: string, day: number): boolean => {
    if (!known(id)) {
      actsOnUnknownIds += 1;
      return false;
    }
    if (day < born.get(id)!) {
      usesBeforeBirth += 1;
      return false;
    }
    return true;
  };

  // ABOUT-MARKS, after birth on their day.
  for (const r of db.query("SELECT memory_id, day, at, reason, actor FROM core_events WHERE action = 'about' ORDER BY seq").all() as Row[]) {
    const id = String(r["memory_id"]);
    const parsed = parseAboutReason(String(r["reason"] ?? ""));
    if (parsed === null) continue;
    if (!known(id)) {
      actsOnUnknownIds += 1;
      continue;
    }
    push(Math.max(num(r["day"]), born.get(id)!), { kind: "about", id, mark: parsed.mark, by: str(r["actor"]) ?? "writer" }, r["at"]);
  }

  // FEELINGS, on the day they were recorded.
  for (const r of db
    .query(
      `SELECT memory_id, whose, core, emotion, other_word, strength, valence, carried_by, source, recorded_later,
              created_at, recorded_day FROM feelings ORDER BY created_at, id`,
    )
    .all() as Row[]) {
    const id = String(r["memory_id"]);
    if (!known(id)) {
      actsOnUnknownIds += 1;
      continue;
    }
    push(Math.max(num(r["recorded_day"] ?? born.get(id)), born.get(id)!), {
      kind: "feeling",
      id,
      whose: String(r["whose"]),
      core: String(r["core"]),
      emotion: String(r["emotion"]),
      otherWord: str(r["other_word"]),
      strength: num(r["strength"]),
      valence: r["valence"] === null ? null : num(r["valence"]),
      carriedBy: String(r["carried_by"] ?? ""),
      source: str(r["source"]),
      recordedLater: str(r["recorded_later"]),
      createdAt: num(r["created_at"]),
    }, r["created_at"]);
  }

  // USES. With `recorded`, the recorded awake returns are pinned as cued uses
  // (ordered among the day's other acts by their own instants, below).
  if (returnsMode === "recorded") {
    const marks = AWAKE_RETURN_SOURCES.map(() => "?").join(",");
    for (const r of db.query(`SELECT memory_id, day, source, session, at FROM returns WHERE source IN (${marks}) ORDER BY at`).all(...AWAKE_RETURN_SOURCES) as Row[]) {
      const id = String(r["memory_id"]);
      const day = num(r["day"]);
      if (!usable(id, day)) continue;
      push(day, { kind: "use", id, tier: RETURN_TIER[String(r["source"])] ?? "referenced", cued: true, session: str(r["session"]), from: "return" }, r["at"]);
    }
  }
  for (const r of db.query("SELECT day, at, payload FROM events WHERE name IN ('recall.credit', 'recall.rated') ORDER BY seq").all() as Row[]) {
    const p = parse(r["payload"]);
    const day = num(p["day"] ?? r["day"]);
    const session = str(p["session"]);
    if (Array.isArray(p["ratings"])) {
      for (const x of p["ratings"] as Row[]) {
        const id = str(x["id"]);
        const tier = RATED_TIER[num(x["score"])];
        if (id === null || tier === undefined || !usable(id, day)) continue;
        push(day, { kind: "use", id, tier, cued: false, session, from: "rated" }, r["at"]);
      }
      continue;
    }
    if (p["reason"] !== "credited") continue;
    const list = ids(p["ids"]);
    creditIdsCut += Math.max(0, num(p["idsTotal"] ?? list.length) - list.length);
    if (p["source"] === "drewOn") {
      for (const id of list) if (usable(id, day)) push(day, { kind: "use", id, tier: "engaged", cued: false, session, from: "drewOn" }, r["at"]);
      continue;
    }
    const expanded = new Set(ids(p["expandedIds"]));
    for (const id of list) {
      if (!usable(id, day)) continue;
      // Quoted is cued, as live (`counterpart.ts#creditReferences`); expanded lets the display decide.
      push(day, { kind: "use", id, tier: "referenced", cued: !expanded.has(id), session, from: "credit" }, r["at"]);
    }
  }

  // NIGHT RETURNS: the dream's replays and the reflection's citations.
  for (const r of db.query("SELECT memory_id, day, source, dream_id, session, at FROM returns WHERE source IN ('dream', 'reflection') ORDER BY at").all() as Row[]) {
    const id = String(r["memory_id"]);
    const day = num(r["day"]);
    if (!usable(id, day)) continue;
    push(day, { kind: "night-return", id, source: r["source"] === "dream" ? "dream" : "reflection", dreamId: str(r["dream_id"]), session: str(r["session"]) }, r["at"]);
  }

  // SETTLES, on their day, with the actor that settled them.
  const actorOf = db.query("SELECT actor, actor_id, at FROM contradiction_settles WHERE pair_id = ? AND action = 'settled' ORDER BY seq DESC LIMIT 1");
  for (const r of db.query("SELECT id, how, holds, over, settled_day FROM contradictions WHERE state = 'settled' ORDER BY settled_day, created_at").all() as Row[]) {
    const holds = str(r["holds"]);
    const over = str(r["over"]);
    const how = str(r["how"]);
    if (holds === null || over === null || how === null) continue;
    if (!known(holds) || !known(over)) {
      actsOnUnknownIds += 1;
      continue;
    }
    const a = actorOf.get(String(r["id"])) as Row | null;
    const day = Math.max(num(r["settled_day"]), born.get(holds)!, born.get(over)!);
    push(day, { kind: "settle", pair: String(r["id"]), how, holds, over, actor: str(a?.["actor"]) ?? "session", actorId: str(a?.["actor_id"]) }, a?.["at"]);
  }

  // MERGES: what a dream folded into a new memory leaves on the merge's day.
  const mergeDay = db.query(
    "SELECT version_day AS d, archived_at AS at, successor_id AS succ FROM versions WHERE memory_id = ? AND reason = 'dream-merge' ORDER BY seq LIMIT 1",
  );
  for (const r of db.query(`SELECT id FROM memories WHERE ${REPLAYED} AND archived = 1 AND archived_reason = 'dream-merge'`).all() as Row[]) {
    const id = String(r["id"]);
    const v = mergeDay.get(id) as Row | null;
    if (v === null || v["d"] === null) {
      mergesUndated += 1;
      continue;
    }
    const into = str(v["succ"]);
    push(Math.max(num(v["d"]), born.get(id)!), { kind: "merge", id, into: into !== null && known(into) ? into : null }, v["at"]);
  }

  // FEED ORDER inside a day: births, marks, feelings, uses, night returns,
  // settles, merges — a memory exists before anything happens to it.
  const order: Record<Act["kind"], number> = { birth: 0, about: 1, feeling: 2, use: 3, "night-return": 4, settle: 5, merge: 6 };
  const lastDay = Math.max(livedDay, ...acts.keys());
  const days: RecordedDay[] = [];
  const learnedOn = db.query("SELECT MIN(learned_on) AS d FROM memories WHERE birth_day = ? AND learned_on <> ''");
  // THE DATES. The replay's clock moves one lived day per NEW date (after the
  // first boundary, which always moves it), so after day 1 every day needs a
  // date strictly later than the day before, and a day whose sleep-cycle row
  // is gone (pruned past retention, or an append that failed) must fit
  // strictly between its dated neighbours: dated by what was learned on it,
  // else as the day after the one before, and refused when there is no room
  // rather than silently landing on a neighbour's date.
  const dayDates: string[] = [];
  for (let d = 0; d <= lastDay; d++) {
    const prev = d === 0 ? "" : dayDates[d - 1]!;
    let date = dateOf.get(d);
    if (date === undefined) {
      daysDatedByFallback += 1;
      let n = d + 1;
      while (n <= lastDay && !dateOf.has(n)) n += 1;
      const next = dateOf.get(n);
      // Day 1 may share day 0's date (the first boundary always moves the clock).
      const fits = (x: string): boolean => (d === 1 ? x >= prev : x > prev) && (next === undefined || x < next);
      const learned = str((learnedOn.get(d) as Row | null)?.["d"]);
      date = learned !== null && fits(learned) ? learned : nextDate(prev === "" ? created : prev);
      if (!fits(date)) throw new SourceError("SOURCE_DAYS_UNDATABLE", `lived day ${String(d)} has no sleep cycle and no free date between ${prev} and ${String(next)}`);
    }
    if (d >= 2 ? date <= prev : date < prev) {
      throw new SourceError("SOURCE_DAYS_OUT_OF_ORDER", `lived day ${String(d)} is dated ${date}, not after day ${String(d - 1)}'s ${prev}`);
    }
    dayDates.push(date);
  }
  for (let d = 0; d <= lastDay; d++) {
    const date = dayDates[d]!;
    // By recorded instant; an act never before its memory's birth (a clamped
    // instant ties, and the kind order puts the birth first); the kind order
    // also settles acts the record gave no instant.
    const list = (acts.get(d) ?? []).map((x, i) => {
      const ids = x.act.kind === "birth" ? [] : x.act.kind === "settle" ? [x.act.holds, x.act.over] : [x.act.id];
      if (x.act.kind === "merge" && x.act.into !== null) ids.push(x.act.into);
      const at = Math.max(x.at, ...ids.map((id) => bornAt.get(id) ?? 0));
      return { a: x.act, at, i };
    });
    list.sort((x, y) => x.at - y.at || order[x.a.kind] - order[y.a.kind] || x.i - y.i);
    days.push({ day: d, date, acts: list.map((x) => x.a) });
  }

  return {
    days,
    outcome: readOutcome(db),
    gaps: { creditIdsCut, actsOnUnknownIds, usesBeforeBirth, bodiesFromCurrentRow, mergesUndated, daysDatedByFallback },
    schemaVersion,
    livedDay,
    eventsFrom,
    memoriesReplayed: born.size,
    chapterCopiesSkipped: num((db.query("SELECT COUNT(*) AS n FROM memories WHERE type = 'memory' AND source = 'episode'").get() as Row)["n"]),
  };
}

/** The same outcome read off any store file: the source's, or a replay's own, so both sides are read by one function. */
export function readOutcomeAt(path: string): RecordedOutcome {
  const db = new Database(path, { readonly: true });
  try {
    return readOutcome(db);
  } finally {
    db.close();
  }
}

function readOutcome(db: Database): RecordedOutcome {
  const uses = new Map<string, number>();
  const bands = new Map<string, string>();
  const archived = new Set<string>();
  for (const r of db.query(`SELECT id, uses, band, archived FROM memories WHERE ${REPLAYED}`).all() as Row[]) {
    const id = String(r["id"]);
    uses.set(id, num(r["uses"]));
    if (num(r["archived"]) === 1) archived.add(id);
    else bands.set(id, String(r["band"]));
  }
  const promotions = (db.query("SELECT memory_id, day, lane FROM core_events WHERE action = 'promoted' ORDER BY seq").all() as Row[]).map((r) => ({
    id: String(r["memory_id"]),
    day: num(r["day"]),
    lane: str(r["lane"]),
  }));
  const marks = AWAKE_RETURN_SOURCES.map(() => "?").join(",");
  const awakeReturns = (db.query(`SELECT memory_id, day, source, weight FROM returns WHERE source IN (${marks}) ORDER BY at`).all(...AWAKE_RETURN_SOURCES) as Row[]).map((r) => ({
    id: String(r["memory_id"]),
    day: num(r["day"]),
    source: String(r["source"]),
    weight: num(r["weight"]),
  }));
  return { uses, bands, promotions, awakeReturns, archived };
}

/** Exposed for the CLI's default: where the brief keeps the corpus copy. */
export const DEFAULT_CORPUS = join(homedir(), "counterparts-backups", "2026-10-20-corpus", "counterparts.sqlite");
