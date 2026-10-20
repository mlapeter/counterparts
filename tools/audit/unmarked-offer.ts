/**
 * THE UNMARKED OFFER, COUNTED — read-only, on a COPY of a store (2026-10-20).
 *
 * How many memories nobody marked the work lane counts as a project's work
 * only for want of a mark (`self/work.ts#isWorkMemory`), how many a lived day
 * adds, and how many of them read as personal by the reflection's own order
 * (`core/dream/unmarked.ts`). Prints counts only — never a memory's words or
 * a name. Approximates the reflection's bundle: live, not a dream's or a
 * reflection's, not confidential (the night's bundle is a guest's).
 *
 * Never on a live store: it refuses any path under ~/.counterparts or
 * ~/.bansai, and opens the file read-only. Copy a snapshot first:
 *
 *   cp -R ~/.counterparts/snapshots/<newest> /tmp/snap   (not store/spans)
 *   bun tools/audit/unmarked-offer.ts /tmp/snap/<…>/counterparts.sqlite [--days 14]
 */
import { Database } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import { personNames, unmarkedRanker } from "../../src/core/dream/unmarked.js";
import { isWorkMemory } from "../../src/core/self/work.js";
import type { Kind } from "../../src/core/types.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const daysAt = args.indexOf("--days");
const DAYS = daysAt >= 0 ? Number(args[daysAt + 1] ?? 14) : 14;
if (file === undefined) {
  console.error("usage: bun tools/audit/unmarked-offer.ts <copy of counterparts.sqlite> [--days 14]");
  process.exit(2);
}
const real = realpathSync(file);
for (const live of [join(homedir(), ".counterparts"), join(homedir(), ".bansai")]) {
  let liveReal = live;
  try {
    liveReal = realpathSync(live);
  } catch {
    /* absent */
  }
  if (real === liveReal || real.startsWith(liveReal + sep)) {
    console.error(`refusing ${real}: it is under ${liveReal}. Copy a snapshot somewhere else first.`);
    process.exit(2);
  }
}

const db = new Database(`file:${real}?mode=ro`, { readonly: true });
interface Row {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  uses: number;
  created_at: number | null;
  birth_day: number;
  about: string | null;
  origin_scope: string | null;
  meta: string;
}
const rows = db
  .query<Row, []>(
    `SELECT id, kind, title, body, uses, created_at, birth_day, about, origin_scope, meta FROM memories
     WHERE type = 'memory' AND archived = 0 AND confidential = 0 AND superseded_by IS NULL
       AND (source IS NULL OR source NOT IN ('dreamed', 'reflection'))`,
  )
  .all();
const felt = new Set(db.query<{ memory_id: string }, []>(`SELECT DISTINCT memory_id FROM feelings`).all().map((r) => r.memory_id));
const owner: string[] = [];
for (const r of db.query<{ meta: string }, []>(`SELECT meta FROM memories WHERE type = 'schema' AND kind = 'self' AND archived = 0`).all()) {
  try {
    const m = JSON.parse(r.meta) as Record<string, unknown>;
    if (m["role"] !== "entity") continue;
    for (const v of [m["name"], ...(Array.isArray(m["aliases"]) ? m["aliases"] : [])]) if (typeof v === "string" && v.trim().length >= 2) owner.push(v.trim().toLowerCase());
  } catch {
    /* skip */
  }
}
const journal = (meta: string): boolean => {
  try {
    return typeof (JSON.parse(meta) as Record<string, unknown>)["episodeId"] === "string";
  } catch {
    return false;
  }
};
const cards = db.query<{ title: string | null; meta: string }, []>(`SELECT title, meta FROM memories WHERE type = 'schema' AND kind = 'person' AND archived = 0 AND confidential = 0`).all();
const people = personNames([...rows.filter((r) => r.kind === "person"), ...cards], owner);
const rank = unmarkedRanker({ owner, people });

const pool = rows.filter((r) => r.about === null && isWorkMemory({ about: null, kind: r.kind as Kind, originScope: r.origin_scope, journal: journal(r.meta) }));
const ranked = pool.map((r) => ({ r, n: rank({ id: r.id, kind: r.kind, title: r.title, body: r.body, uses: r.uses, createdAt: r.created_at ?? 0, felt: felt.has(r.id) }) }));
const today = Math.max(0, ...rows.map((r) => r.birth_day));
const recent = (d: number): boolean => d > today - DAYS;

const byKind: Record<string, number> = {};
for (const { r } of ranked) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
const byRank: Record<string, number> = {};
for (const { n } of ranked) byRank[String(n)] = (byRank[String(n)] ?? 0) + 1;

const perDay: { day: number; written: number; marked: number; unmarkedWork: number; personalLooking: number }[] = [];
for (let d = today - DAYS + 1; d <= today; d++) {
  const born = rows.filter((r) => r.birth_day === d);
  const unm = ranked.filter((x) => x.r.birth_day === d);
  perDay.push({ day: d - today, written: born.length, marked: born.filter((r) => r.about !== null).length, unmarkedWork: unm.length, personalLooking: unm.filter((x) => x.n > 0).length });
}
const recentPool = ranked.filter((x) => recent(x.r.birth_day));
const avg = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);

console.log(JSON.stringify(
  {
    liveMemories: rows.length,
    unmarkedWorkPool: pool.length,
    poolByKind: byKind,
    poolByRank: byRank,
    poolPersonalLooking: ranked.filter((x) => x.n > 0).length,
    poolSigns: {
      felt: ranked.filter((x) => felt.has(x.r.id)).length,
      ownerNames: owner.length,
      peopleNames: people.length,
    },
    lastDays: DAYS,
    perLivedDay: perDay,
    avgUnmarkedWorkPerDay: avg(perDay.map((p) => p.unmarkedWork)),
    avgPersonalLookingPerDay: avg(perDay.map((p) => p.personalLooking)),
    recentPool: recentPool.length,
  },
  null,
  2,
));
db.close();
