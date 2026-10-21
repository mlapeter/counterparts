#!/usr/bin/env bun
/**
 * `tools/sim/consolidation` — the simulations behind the dreaming +
 * consolidation redesign (2026-09-26). Prints the tables `physics/NOTES.md`
 * ("Returns, core lanes and the v8 upgrade") quotes. Two parts:
 *
 *   A. THE UPGRADE, on the demo store. With `--v7-src <dir>` (a checkout of a
 *      v7 build, e.g. `git archive origin/master src tools package.json | tar
 *      -x -C <dir>`), THAT build's `tools/demo/seed.ts` seeds it, so the store
 *      is a real v7 one — its consolidated rows marked and its promotions made
 *      by the old rules. Without it, this build seeds and the store is taken
 *      back to the v7 shape (no consolidated rows then). Either way this build
 *      then opens it — copying and migrating it — and compares every live
 *      memory's band and projected prune day, pre-v8 arithmetic vs v8, by
 *      kind; then runs one sleep and prints the census the store recorded.
 *   B. SIXTY LIVED DAYS on a synthetic store: organic returns (cued by a
 *      turn), a strong memory used every time the hints lane shows it (the
 *      rich-get-richer loop), memories about me felt and unfelt, memories about
 *      somebody else, a burst of eligible memories to exercise the nightly cap.
 *      Prints what the hints lane did, what became core by which lane on which
 *      day, and what the returns did to durability.
 *
 * Hermetic: temp directories only, removed at the end; zero API calls. Run:
 *   ~/.bun/bin/bun run tools/sim/consolidation.ts
 */
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Counterpart } from "../../src/core/counterpart.js";
import { band, stability, strength } from "../../src/core/physics/index.js";
import type { Band, Kind, MemoryPhysics } from "../../src/core/physics/index.js";
import { V8_CENSUS_KEY, preV8, projectedPruneDay, runCycle } from "../../src/core/sleep/index.js";
import { Store, paths, rowToPhysics } from "../../src/core/store/index.js";
import type { FeelingPeak, MemoryRow } from "../../src/core/store/index.js";

const ROOT = mkdtempSync(join(tmpdir(), "counterparts-sim-"));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function date(day: number): string {
  const d = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. the upgrade
// ─────────────────────────────────────────────────────────────────────────────

const V8_COLUMNS = ["legacy", "returns", "return_days", "first_return_day", "last_return_day", "last_dream_day"];

function stripToV7(dir: string): void {
  const db = new Database(paths.operational(dir));
  for (const t of ["dream_changes", "returns", "wake_display", "dreams", "dream_asks", "core_events"]) db.run(`DROP TABLE IF EXISTS ${t}`);
  for (const c of [...V8_COLUMNS].reverse()) db.run(`ALTER TABLE memories DROP COLUMN ${c}`);
  db.run("DELETE FROM meta WHERE key LIKE 'physics.v8.%'");
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', '7')");
  db.close();
}

function rawPhysics(dir: string): Map<string, MemoryPhysics> {
  const d = new Database(paths.operational(dir), { readonly: true });
  const rows = d
    .prepare(
      `SELECT m.*, (SELECT MAX(f.strength) FROM feelings f WHERE f.memory_id = m.id) AS feeling_peak
         FROM memories m WHERE m.archived = 0 AND m.type != 'episode'`,
    )
    .all() as (MemoryRow & FeelingPeak)[];
  d.close();
  return new Map(rows.map((r) => [r.id, rowToPhysics(r)]));
}

function partA(): void {
  const dir = join(ROOT, "demo");
  const at = process.argv.indexOf("--v7-src");
  const v7src = at === -1 ? null : (process.argv[at + 1] ?? null);
  const seedScript = v7src === null ? resolve(import.meta.dir, "../demo/seed.ts") : resolve(v7src, "tools/demo/seed.ts");
  const seeded = spawnSync(process.execPath, ["run", seedScript, "--dir", dir], { encoding: "utf8" });
  if (seeded.status !== 0) throw new Error(`seed failed: ${seeded.stderr}`);
  // A store this build seeded is taken back to the v7 shape; one a v7 build
  // seeded already is one.
  if (v7src === null) stripToV7(dir);
  console.log(`(seeded by ${v7src === null ? "this build, stripped to v7" : `the v7 build at ${v7src}`})`);
  const before = rawPhysics(dir);
  const s = Store.open({ dir, snapshotsDir: join(ROOT, "demo-snaps") });
  const day = s.livedDay();
  type Tally = { rows: number; consolidated: number; bandMoved: number; pruneSooner: number; pruneLater: number; bands: Record<Band, number> };
  const byKind = new Map<Kind, Tally>();
  for (const [id, old] of before) {
    const now = s.physicsOf(id);
    const t = byKind.get(now.kind) ?? { rows: 0, consolidated: 0, bandMoved: 0, pruneSooner: 0, pruneLater: 0, bands: { episodic: 0, semantic: 0, identity: 0 } };
    t.rows += 1;
    if (now.consolidated) t.consolidated += 1;
    if (band(now, day) !== band(old, day)) t.bandMoved += 1;
    t.bands[band(now, day)] += 1;
    const pn = projectedPruneDay(now);
    const po = projectedPruneDay(old);
    if (pn !== null && po !== null) {
      if (pn < po) t.pruneSooner += 1;
      if (pn > po) t.pruneLater += 1;
    }
    byKind.set(now.kind, t);
  }
  console.log(`\n## A. The v7 → v8 upgrade on the seeded demo store (lived day ${day}, ${before.size} live memories)\n`);
  console.log("| kind | rows | consolidated (kept) | episodic / semantic / identity | band moved at upgrade | prune day sooner | later |");
  console.log("|---|---|---|---|---|---|---|");
  for (const [kind, t] of [...byKind].sort()) {
    console.log(`| ${kind} | ${t.rows} | ${t.consolidated} | ${t.bands.episodic} / ${t.bands.semantic} / ${t.bands.identity} | ${t.bandMoved} | ${t.pruneSooner} | ${t.pruneLater} |`);
  }
  runCycle({ store: s, date: date(400) });
  console.log(`\nCensus the first sleep recorded (\`${V8_CENSUS_KEY}\`): ${s.getMeta(V8_CENSUS_KEY) ?? "(none)"}`);
  s.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// B. sixty lived days
// ─────────────────────────────────────────────────────────────────────────────

interface Actor {
  readonly id: string;
  readonly label: string;
  /** Chance per lived day that a turn's own words bring it back (a cued use). */
  readonly p: number;
}

async function partB(): Promise<void> {
  const rng = mulberry32(20260926);
  const dir = join(ROOT, "sixty");
  let clock = Date.UTC(2026, 0, 1, 12);
  const c = Counterpart.open({ dir, identity: { name: "Mike" }, now: () => clock, timeZone: "UTC", budgetBytes: 9_000 });
  const put = (kind: Kind, body: string, dims: { r: number; e: number; p: number }): string =>
    c.store.put({
      type: "memory",
      kind,
      body,
      salience: { novelty: null, relevance: dims.r, emotional: dims.e, predictive: dims.p },
      physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
    });

  const actors: Actor[] = [];
  const loop = put("fact", "The long conversation about his father that keeps coming back.", { r: 1, e: 1, p: 1 });
  for (let i = 0; i < 20; i++) {
    const r = 0.45 + 0.45 * rng();
    actors.push({ id: put("fact", `Ordinary fact number ${i} about the project, with its own weight.`, { r, e: 0.3, p: r }), label: `fact ${i}`, p: 0.06 });
  }
  const selfFelt = [0, 1].map((i) => ({ id: put("self", `I felt it deeply when ${i === 0 ? "the launch" : "the first user"} worked.`, { r: 0.7, e: 0.85, p: 0.6 }), label: `self felt ${i}`, p: 0.12 }));
  const selfSteady = [0, 1].map((i) => ({ id: put("self", `I keep coming back to a habit of mine, number ${i}.`, { r: 0.6, e: 0.1, p: 0.6 }), label: `self steady ${i}`, p: 0.3 }));
  const selfRare = [0, 1].map((i) => ({ id: put("self", `A passing thought about myself, number ${i}.`, { r: 0.5, e: 0.1, p: 0.4 }), label: `self rare ${i}`, p: 0.03 }));
  const mikeFelt = { id: put("person", "Mike was proud and quiet when the demo finally ran.", { r: 0.7, e: 0.8, p: 0.6 }), label: "Mike felt", p: 0.1 };
  const mikeSteady = [0, 1, 2].map((i) => ({ id: put("person", `Mike prefers to talk decisions through out loud, case ${i}.`, { r: 0.6, e: 0.2, p: 0.6 }), label: `Mike steady ${i}`, p: 0.25 }));
  const ada = [0, 1, 2].map((i) => ({ id: put("person", `Ada reviews code carefully, note ${i}.`, { r: 0.8, e: 0.7, p: 0.7 }), label: `Ada ${i}`, p: 0.4 }));
  actors.push(...selfFelt, ...selfSteady, ...selfRare, mikeFelt, ...mikeSteady, ...ada);
  const burst: Actor[] = [];

  const hintsShown = new Map<string, number>();
  let loopDays = 0;
  let streak = 0;
  let longest = 0;
  const lanes: { day: number; label: string; lane: string }[] = [];
  let capped = 0;
  const label = new Map<string, string>([[loop, "LOOP"], ...actors.map((a) => [a.id, a.label] as const)]);

  for (let d = 1; d <= 60; d++) {
    clock += 86_400_000;
    const at = date(d);
    const report = await c.sessionEnd({ date: at, at });
    const cons = report.cycle.phases.find((p) => p.phase === "consolidate");
    capped += cons?.skipped["promotion:cap"] ?? 0;
    for (const p of report.cycle.promoted) lanes.push({ day: d, label: label.get(p.id) ?? p.id, lane: p.lane });
    const day = c.store.livedDay();
    const shownToday = [...c.store.wakeDisplays().values()].filter((r) => r.lane === "hints" && r.shown_day === day && r.closed_day === null);
    for (const r of shownToday) hintsShown.set(r.memory_id, (hintsShown.get(r.memory_id) ?? 0) + 1);
    // THE LOOP: whenever the lane shows it, the session expands it by id.
    if (c.store.shownInHints(loop, day)) {
      loopDays += 1;
      streak += 1;
      longest = Math.max(longest, streak);
      c.store.reinforce(loop, day, "referenced");
    } else streak = 0;
    // Organic returns: a turn's own words bring it up. The burst all come
    // back on day 12, so five are eligible at once on the next consolidation.
    for (const a of [...actors, ...burst]) {
      const certain = d === 12 && burst.includes(a);
      if (certain || rng() < a.p) c.store.reinforce(a.id, day, "referenced", { cued: true });
    }
    // Two new facts a day keep the store growing, and the hints lane contested.
    for (let k = 0; k < 2; k++) {
      const r = 0.3 + 0.6 * rng();
      put("fact", `New fact from lived day ${d}, number ${k}.`, { r, e: 0.2, p: r });
    }
    // A BURST of five felt memories about me, all eligible at once, on day 10.
    if (d === 10) {
      for (let k = 0; k < 5; k++) {
        const id = put("self", `A strongly felt moment about who I am, burst ${k}.`, { r: 0.6 + 0.05 * k, e: 0.9, p: 0.6 });
        burst.push({ id, label: `burst ${k}`, p: 0.5 });
        label.set(id, `burst ${k}`);
      }
    }
  }

  console.log("\n## B. Sixty lived days\n");
  console.log(`Hints lane (HINTS_MAX 8): the loop memory — used every time it was shown — was shown on ${loopDays} of 60 days; longest run ${longest} days in a row. ${hintsShown.size} distinct memories were shown over the run.`);
  const loopP = c.store.physicsOf(loop);
  console.log(`The loop memory: uses ${loopP.uses.toFixed(0)}, returns ${String(loopP.returns ?? 0)} (every use was on display), promoted: ${loopP.promotedIdentity}.`);
  console.log("\nBecame core (day, memory, lane):\n");
  console.log("| day | memory | lane |");
  console.log("|---|---|---|");
  for (const l of lanes) console.log(`| ${l.day} | ${l.label} | ${l.lane} |`);
  console.log(`\nNights the cap held something back: promotion:cap skips summed = ${capped}.`);
  const never = actors.filter((a) => !c.store.physicsOf(a.id).promotedIdentity).map((a) => `${a.label} (${c.store.physicsOf(a.id).returnDays} return days)`);
  console.log(`Not core at day 60: ${never.join(", ")}.`);
  // Durability: returned vs never-returned facts of similar salience.
  const day = c.store.livedDay();
  const rows = actors.filter((a) => a.label.startsWith("fact")).map((a) => ({ a, p: c.store.physicsOf(a.id) }));
  console.log("\nFacts at day 60 — returns vs stability and strength:\n");
  console.log("| returns (weighted) | return days | uses | stability S (lived days) | strength today | band |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows.sort((x, y) => (y.p.returns ?? 0) - (x.p.returns ?? 0)).slice(0, 6)) {
    console.log(`| ${(r.p.returns ?? 0).toFixed(2)} | ${r.p.returnDays ?? 0} | ${r.p.uses.toFixed(0)} | ${stability(r.p).toFixed(0)} | ${strength(r.p, day).toFixed(2)} | ${band(r.p, day)} |`);
  }
  const noReturn = rows.filter((r) => (r.p.returns ?? 0) === 0);
  if (noReturn.length > 0) {
    const r = noReturn[0] as { p: MemoryPhysics };
    console.log(`| 0 (and ${noReturn.length - 1} more like it) | 0 | ${r.p.uses.toFixed(0)} | ${stability(r.p).toFixed(0)} | ${strength(r.p, day).toFixed(2)} | ${band(r.p, day)} |`);
  }
  // The same fact with its returns set aside (pre-v8 arithmetic, no legacy bonus either way).
  const top = rows.sort((x, y) => (y.p.returns ?? 0) - (x.p.returns ?? 0))[0];
  if (top !== undefined) {
    console.log(`\nThe most-returned fact: S = ${stability(top.p).toFixed(0)} lived days with its returns, ${stability(preV8(top.p)).toFixed(0)} without them.`);
  }
  c.close();
}

try {
  partA();
  await partB();
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
