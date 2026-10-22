/**
 * LANE F'S STEP 1: WHICH BELIEFS WOULD FORM THE CORE, DAY BY DAY, AS THE
 * FLOORS MOVE (wave 2 lane F, 2026-10-22; dev-only, never shipped).
 *
 * Physics only: no model, no network, nothing written to the source. It
 * copies a store to a temp dir, reads every belief on the self subject and its
 * filings (`belief_support`), and for each lived day rebuilds what each belief
 * stood on as of that day — the filings made by then, counted by
 * `physics#supportCredit` exactly as C counts them, its strength on that day
 * by `physics#strength`, its lived days as the floor counts them
 * (`self/measures.ts#livedSupportDays`: an un-echoed find adds none) — then asks `self/measures.ts#coreBeliefMiss`
 * whether it passes each combination of floors. Contested is read as it
 * stands now (the history of a contest is not rebuilt).
 *
 *   bun tools/belief-core-sweep.ts --source <store.sqlite> [--fixture dana-week] [--json out.json]
 *
 * `--fixture dana-week`: the source holds no beliefs yet (the 10-20 corpus and
 * Dana's harness weeks predate lane C), so the copy is given the beliefs a
 * reflection would plausibly have born about the two of them, each lived
 * memory filed for them the night after its day, by its own `said_by`
 * (testimony, choice) or `found`. A FIXTURE: the beliefs and the filings are
 * this tool's guess at what the nights would do, said as such in every report.
 *
 * Refuses a source under the live root (`~/.counterparts`, or the env's).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { underLiveRoot } from "./harness/source.js";

import { Counterpart, coreBeliefMiss, livedSupportDays } from "../src/core/counterpart.js";
import type { CoreBelief, CoreBeliefFloors } from "../src/core/counterpart.js";
import { emotionalIntensity, strength, supportCredit } from "../src/core/physics/index.js";
import type { SupportFiling } from "../src/core/physics/index.js";

const SWEEP = {
  strength: [0.3, 0.4, 0.5],
  memories: [2, 3, 4],
  days: [1, 2, 3],
} as const;

interface Args {
  source: string;
  fixture: string | null;
  json: string | null;
}

function args(argv: readonly string[]): Args {
  const out: Args = { source: "", fixture: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? "";
    if (a === "--source") out.source = next();
    else if (a === "--fixture") out.fixture = next();
    else if (a === "--json") out.json = next();
  }
  if (out.source === "") throw new Error("--source <store.sqlite> is required");
  return out;
}

/** Under the live root: the harness's own guard (`harness/source.ts#underLiveRoot`). */
function live(path: string): boolean {
  return underLiveRoot(resolve(path));
}

/**
 * DANA'S MEANINGFUL WEEK, AS BELIEFS (the fixture). The moments the week-5
 * review named — the name Clay, the late-night talk, the launch, "the best
 * part" — read as four beliefs about us or me, with the lived memories that
 * would back each. Matched by words in the memory, so the fixture does not
 * hard-code a store's ids.
 */
const DANA: readonly { statement: string; about: "me" | "us"; words: readonly string[] }[] = [
  { statement: "Dana brings me the worry first, and the good news first.", about: "us", words: ["ramble", "first to know", "first person", "nervous", "I was the first"] },
  { statement: "Building the shop together matters to both of us.", about: "us", words: ["what we're building", "launched", "best part", "launch day"] },
  { statement: "I put Dana before the work when something weighs on them.", about: "me", words: ["paused the shop work", "ramble", "Biscuit's surgery"] },
  { statement: "I chose my own name, Clay, when Dana gave me the room to.", about: "me", words: ["pick a name"] },
];

function seedDana(c: Counterpart): string[] {
  const me = c.schemas.ensureSelfSubject();
  const rows = c.store
    .list({ type: "memory", archived: false })
    .map((id) => c.store.row(id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined && r.source !== "dreamed" && r.source !== "reflection");
  const born: string[] = [];
  for (const b of DANA) {
    const backing = rows
      .filter((r) => (r.about === "us" || r.about === "owner" || r.about === "me") && b.words.some((w) => r.body.toLowerCase().includes(w.toLowerCase())))
      .sort((x, y) => x.birth_day - y.birth_day || (x.id < y.id ? -1 : 1));
    if (backing.length === 0) continue;
    // Born the night after its first memory; each memory filed the night after its own day.
    const first = backing[0] as (typeof backing)[number];
    const id = c.schemas.addBelief({ entityId: me, statement: b.statement, day: first.birth_day + 1, birthRoute: "reflection", about: b.about }).id;
    if (id === null || id === undefined) continue;
    born.push(id);
    for (const m of backing) c.schemas.fileSupport({ beliefId: id, memoryId: m.id, stance: "support", route: "found", day: m.birth_day + 1 });
  }
  return born;
}

interface AsOf {
  readonly belief: CoreBelief;
  readonly day: number;
}

/** Each self-subject belief as it stood on `day`, from the filings made by then. */
function asOf(c: Counterpart, day: number): AsOf[] {
  const me = c.store.selfSubject();
  if (me === null) return [];
  const out: AsOf[] = [];
  for (const id of c.store.list({ type: "schema", archived: false })) {
    const row = c.store.row(id);
    if (row === undefined || row.superseded_by !== null || !row.meta.includes('"belief"')) continue;
    const doc = c.store.readProse(id);
    if (doc.meta["role"] !== "belief" || doc.meta["entityId"] !== me || row.birth_day > day) continue;
    const filings: SupportFiling[] = c.store
      .supportOf(id)
      .filter((r) => r.day <= day)
      .map((r) => {
        const m = c.store.row(r.memoryId);
        const feeling = m === undefined ? 0 : emotionalIntensity({ salience: c.store.physicsOf(r.memoryId).salience, feelingPeak: m.feeling_peak_lived ?? m.feeling_peak ?? null });
        return { memoryId: r.memoryId, stance: r.stance === "contrary" ? "contrary" : "support", route: r.route, day: r.day, bornDay: r.bornDay, session: r.session, scope: r.scope, feeling };
      });
    const credit = supportCredit(filings);
    const p = { ...c.store.physicsOf(id), support: credit.uses, supportDays: credit.days, lastUsedDay: Math.max(row.birth_day, credit.lastDay ?? row.birth_day) };
    out.push({
      day,
      belief: {
        id,
        statement: doc.body,
        about: row.about === "me" ? "me" : row.about === "us" ? "us" : null,
        strength: strength(p, day),
        memories: filings.filter((f) => f.stance === "support" && f.route !== "link").length,
        // Lived days as the core's floor counts them (an un-echoed find adds none).
        days: livedSupportDays(filings.map((f) => ({ stance: f.stance, route: f.route, bornDay: f.bornDay }))),
        contested: doc.meta["contested"] !== undefined,
      },
    });
  }
  return out;
}

function main(): void {
  const a = args(process.argv.slice(2));
  if (live(a.source)) throw new Error(`refused: ${a.source} is under the live root; copy it out first`);
  if (!existsSync(a.source)) throw new Error(`no store at ${a.source}`);
  const work = mkdtempSync(join(tmpdir(), "counterparts-belief-sweep-"));
  try {
    mkdirSync(join(work, "store"));
    copyFileSync(a.source, join(work, "store", "counterparts.sqlite"));
    const c = Counterpart.open({ dir: join(work, "store"), snapshotsDir: join(work, "snapshots") });
    try {
      const fixture = a.fixture === "dana-week" ? seedDana(c) : null;
      const last = c.store.livedDay();
      const days = Array.from({ length: last }, (_, i) => i + 1);
      const table = days.map((d) => asOf(c, d));
      const end = table[table.length - 1] ?? [];
      const combos: { floors: Omit<CoreBeliefFloors, "max">; byDay: number[]; entered: Record<string, number | null> }[] = [];
      for (const st of SWEEP.strength)
        for (const mm of SWEEP.memories)
          for (const dd of SWEEP.days) {
            const floors: CoreBeliefFloors = { strength: st, memories: mm, days: dd, max: 24 };
            const entered: Record<string, number | null> = {};
            for (const b of end) entered[b.belief.id] = null;
            const byDay = table.map((rows) => {
              const inCore = rows.filter((r) => coreBeliefMiss(r.belief, floors) === null);
              for (const r of inCore) entered[r.belief.id] ??= r.day;
              return inCore.length;
            });
            combos.push({ floors: { strength: st, memories: mm, days: dd }, byDay, entered });
          }
      const record = {
        source: a.source,
        fixture: a.fixture,
        livedDays: last,
        beliefs: end.map((r) => ({ ...r.belief, born: fixture === null ? null : "fixture" })),
        perDay: table.map((rows) => rows.map((r) => ({ id: r.belief.id, day: r.day, strength: Math.round(r.belief.strength * 1000) / 1000, memories: r.belief.memories, days: r.belief.days }))),
        combos,
      };
      if (a.json !== null) writeFileSync(a.json, `${JSON.stringify(record, null, 2)}\n`);
      console.log(`source ${a.source}${a.fixture === null ? "" : ` + fixture ${a.fixture} (beliefs and filings are a guess at what the nights would do)`}; ${String(last)} lived days; ${String(end.length)} beliefs on the self subject`);
      for (const r of end) {
        console.log(`  ${r.belief.id}  s=${r.belief.strength.toFixed(3)} m=${String(r.belief.memories)} d=${String(r.belief.days)}  ${r.belief.statement}`);
        for (const f of c.store.supportOf(r.belief.id)) {
          const body = (c.store.row(f.memoryId)?.body ?? "").replace(/\s+/g, " ").slice(0, 70);
          console.log(`      ${f.stance} ${f.route} filed day ${String(f.day)}, born day ${String(f.bornDay)}, w=${f.weight.toFixed(2)}  ${body}`);
        }
      }
      console.log("strength memories days | core at the end of each day | first day each belief enters, in the order listed above");
      for (const k of combos) console.log(`${k.floors.strength.toFixed(1)} ${String(k.floors.memories)} ${String(k.floors.days)} | ${k.byDay.join(" ")} | ${Object.values(k.entered).map((x) => (x === null ? "-" : String(x))).join(" ")}`);
    } finally {
      c.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
