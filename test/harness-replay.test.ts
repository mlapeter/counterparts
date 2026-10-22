/**
 * The physics-only harness (`tools/harness/`): a small recorded store is made
 * here with the real Counterpart, a few acts the record keeps as event rows are
 * written beside it, and the harness replays that record into its own temp
 * store. What is held: the acts land on their days under their own ids, the
 * gaps are counted rather than guessed around, the run record carries no
 * memory text, and the harness refuses the owner's live root and a preset data
 * dir.
 *
 * Hermetic: every store is under a fresh temp dir removed after, and the
 * harness's live-root check is pointed at a fake HOME inside it.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import { Counterpart } from "../src/core/counterpart.js";
import { runningBuild } from "../src/core/store/operational.js";
import { runPhysicsReplay } from "../tools/harness/replay.js";
import { extract, parseAboutReason } from "../tools/harness/source.js";

const SENTINEL = "ZEBRA-SENTINEL-words-only-the-store-may-hold";
const DATES = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];

let root: string;
let source: string;
let work: string;
let env: NodeJS.ProcessEnv;

function midday(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** A five-day record: births on days 0–2, uses, a settle, a feeling, an about-mark. */
async function makeSource(dir: string): Promise<void> {
  let clock = midday(DATES[0]!);
  const c = Counterpart.open({ dir, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
  const put = (id: string, kind: "fact" | "self", body: string, day: number): void => {
    c.store.put({
      id,
      type: "memory",
      kind,
      body,
      salience: { novelty: null, relevance: 0.7, emotional: kind === "self" ? 0.9 : 0.2, predictive: 0.6 },
      physics: { birthDay: day, lastUsedDay: day },
      source: "authored",
    });
  };
  put("mem_aaaaaaaaaaa1", "fact", `The first fact. ${SENTINEL}`, 0);
  put("mem_aaaaaaaaaaa2", "self", "I felt it when the first thing worked.", 0);
  for (let d = 1; d < DATES.length; d++) {
    clock = midday(DATES[d]!);
    await c.sessionEnd({ date: DATES[d]!, sweep: { skipped: "not-opted-in" } });
    if (d === 1) {
      put("mem_aaaaaaaaaaa3", "fact", "A later fact that corrects the first.", 1);
      c.store.setAbout("mem_aaaaaaaaaaa2", "me", { by: "writer", day: 1 });
      c.store.addFeelings("mem_aaaaaaaaaaa2", [{ whose: "self", core: "happy", emotion: "proud", strength: 0.9, carriedBy: "it worked" }]);
    }
    if (d === 2) {
      put("mem_aaaaaaaaaaa4", "fact", "Something from day two.", 2);
      const out = c.settleContradiction({ holds: "mem_aaaaaaaaaaa3", over: "mem_aaaaaaaaaaa1", how: "changed", actor: "session", actorId: "s-1", day: 2 });
      expect(out.ok).toBe(true);
    }
  }
  c.close();

  // The acts the record keeps only as event rows, written as the adapters write them.
  const db = new Database(join(dir, "counterparts.sqlite"));
  const row = db.query("INSERT INTO events (at, day, name, ref, dedup_key, payload) VALUES (?, ?, ?, NULL, NULL, ?)");
  const at = (d: number): number => midday(DATES[d]!) + 3_600_000;
  // Day 2: a boundary credited two expansions; the row was cut at its cap (idsTotal 3).
  row.run(at(2), 2, "recall.credit", JSON.stringify({
    reason: "credited", session: "s-2", day: 2, ids: ["mem_aaaaaaaaaaa2", "mem_aaaaaaaaaaa3"], idsTotal: 3,
    expandedIds: ["mem_aaaaaaaaaaa2", "mem_aaaaaaaaaaa3"],
  }));
  // Day 3: a rating (score 3 = referenced), a rating of nothing (0), an unknown id, a use before birth.
  row.run(at(3), 3, "recall.rated", JSON.stringify({
    session: "s-3", day: 3, ratings: [
      { id: "mem_aaaaaaaaaaa2", score: 3, lane: "footnotes", drewOn: false },
      { id: "mem_aaaaaaaaaaa1", score: 0, lane: "footnotes", drewOn: false },
      { id: "epi_bbbbbbbbbbbb", score: 2, lane: "footnotes", drewOn: false },
    ],
  }));
  row.run(at(1), 1, "recall.credit", JSON.stringify({
    source: "drewOn", reason: "credited", session: "s-1", day: 1, ids: ["mem_aaaaaaaaaaa4"], idsTotal: 1,
  }));
  // Day 4: drewOn on a known memory.
  row.run(at(4), 4, "recall.credit", JSON.stringify({
    source: "drewOn", reason: "credited", session: "s-4", day: 4, ids: ["mem_aaaaaaaaaaa4"], idsTotal: 1,
  }));
  db.close();
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "counterparts-harness-test-"));
  const srcDir = join(root, "recorded");
  await makeSource(srcDir);
  source = join(srcDir, "counterparts.sqlite");
  work = join(root, "work");
  mkdirSync(work);
  env = { HOME: join(root, "home") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("the record reads as lived days of acts, the gaps counted", () => {
  const x = extract(source, { env });
  // Day 0 is the creation date; each later day is the date its first cycle carried.
  expect(x.days.map((d) => d.date)).toEqual(DATES);
  expect(x.days.map((d) => d.day)).toEqual([0, 1, 2, 3, 4]);
  const day0 = x.days[0]!.acts.filter((a) => a.kind === "birth").map((a) => (a as { id: string }).id);
  expect(day0).toEqual(["mem_aaaaaaaaaaa1", "mem_aaaaaaaaaaa2"]);
  const kinds = x.days.flatMap((d) => d.acts.map((a) => `${String(d.day)}:${a.kind}`));
  expect(kinds).toContain("1:about");
  expect(kinds).toContain("1:feeling");
  expect(kinds).toContain("2:settle");
  expect(x.gaps.creditIdsCut).toBe(1);
  expect(x.gaps.actsOnUnknownIds).toBe(1);
  expect(x.gaps.usesBeforeBirth).toBe(1);
  // A mark set later is replayed later; the birth carries the mark it had before.
  const birth2 = x.days[0]!.acts.find((a) => a.kind === "birth" && a.id === "mem_aaaaaaaaaaa2") as { about: string | null };
  expect(birth2.about).toBeNull();
});

test("the replay lands every act on its day, and the record carries no memory text", async () => {
  const r = await runPhysicsReplay({ source, workRoot: work, env });
  expect(r.build).toBe(runningBuild());
  expect(r.days.map((d) => d.births)).toEqual([2, 1, 1, 0, 0]);
  expect(r.days[2]!.uses.credited).toBe(2);
  expect(r.days[2]!.settles).toEqual({ fed: 1, ok: 1 });
  expect(r.days[3]!.uses.credited).toBe(1);
  expect(r.days[4]!.uses.credited).toBe(1);
  expect(r.fidelity).not.toBeNull();
  expect(r.fidelity!.archived.both).toBe(r.fidelity!.archived.recorded);
  expect(JSON.stringify(r)).not.toContain(SENTINEL);
  expect(JSON.stringify(r)).not.toContain("it worked");
  // The temp store is gone unless kept.
  expect(readdirSync(work)).toEqual([]);
});

test("--returns recorded pins the recorded awake returns as cued uses", () => {
  const derived = extract(source, { env, returns: "derived" });
  const pinned = extract(source, { env, returns: "recorded" });
  const uses = (x: typeof derived): number => x.days.flatMap((d) => d.acts).filter((a) => a.kind === "use").length;
  const recordedReturns = new Database(source, { readonly: true });
  const n = (recordedReturns.query("SELECT COUNT(*) AS n FROM returns WHERE source IN ('awake','engaged','ontopic','shown','legacy')").get() as { n: number }).n;
  recordedReturns.close();
  expect(uses(pinned) - uses(derived)).toBe(n);
});

test("keep leaves the replayed store for a look; throughDay stops early and skips the fidelity", async () => {
  const r = await runPhysicsReplay({ source, workRoot: work, env, keep: true, throughDay: 2 });
  expect(r.days.length).toBe(3);
  expect(r.fidelity).toBeNull();
  expect(r.keptAt).not.toBeNull();
  expect(existsSync(join(r.keptAt!, "counterparts.sqlite"))).toBe(true);
});

test("refuses a source under the owner's live root, and a preset data dir", async () => {
  const live = join(env["HOME"]!, ".counterparts", "snapshots");
  mkdirSync(live, { recursive: true });
  copyFileSync(source, join(live, "counterparts.sqlite"));
  expect(() => extract(join(live, "counterparts.sqlite"), { env })).toThrow(/SOURCE_IS_LIVE/);
  await expect(runPhysicsReplay({ source, workRoot: work, env: { ...env, COUNTERPARTS_DATA_DIR: join(root, "x") } })).rejects.toThrow(/DATA_DIR_PRESET/);
  // Refused before anything is made: no folder appears under the live root.
  const under = join(env["HOME"]!, ".counterparts", "not-yet");
  await expect(runPhysicsReplay({ source, workRoot: under, env })).rejects.toThrow(/TARGET_IS_LIVE/);
  expect(existsSync(under)).toBe(false);
});

test("a run that throws still removes its store (it holds the record's words)", async () => {
  await expect(
    runPhysicsReplay({
      source,
      workRoot: work,
      env,
      onDay: (d) => {
        if (d === 2) throw new Error("boom");
      },
    }),
  ).rejects.toThrow(/boom/);
  expect(readdirSync(work)).toEqual([]);
  await expect(runPhysicsReplay({ source, workRoot: work, env, throughDay: Number.NaN })).rejects.toThrow(/BAD_OPTION/);
  expect(readdirSync(work)).toEqual([]);
});

test("a day whose sleep-cycle row was pruned is dated from its neighbours, and counted", () => {
  const copy = join(root, "pruned.sqlite");
  copyFileSync(source, copy);
  const db = new Database(copy);
  db.run("DELETE FROM events WHERE name = 'sleep.cycle' AND day IN (1, 2)");
  db.close();
  const x = extract(copy, { env });
  expect(x.gaps.daysDatedByFallback).toBe(2);
  const dates = x.days.map((d) => d.date);
  expect([...dates].sort()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
});

test("an undated day with no free date between its neighbours is refused, not shifted", async () => {
  // Day 2's row is gone and day 3 is dated the day after day 1: there is no
  // date left between them, and "the day after day 1" would be day 3's own.
  const copy = join(root, "crowded.sqlite");
  copyFileSync(source, copy);
  const db = new Database(copy);
  db.run("DELETE FROM events WHERE name = 'sleep.cycle' AND day = 2");
  db.run("UPDATE events SET payload = json_set(payload, '$.date', ?) WHERE name = 'sleep.cycle' AND day = 3", [DATES[2]!]);
  db.run("UPDATE memories SET learned_on = ? WHERE birth_day = 2", [DATES[1]!]);
  db.close();
  expect(() => extract(copy, { env })).toThrow(/SOURCE_DAYS_UNDATABLE/);
  await expect(runPhysicsReplay({ source: copy, workRoot: work, env })).rejects.toThrow(/SOURCE_DAYS_UNDATABLE/);
  expect(readdirSync(work)).toEqual([]);
});

test("a day's acts replay in the order the record gave them", () => {
  const copy = join(root, "ordered.sqlite");
  copyFileSync(source, copy);
  const db = new Database(copy);
  const at3 = midday(DATES[3]!);
  // A reflection return between two uses of the same day, by recorded instant.
  db.run("INSERT INTO returns (memory_id, day, source, weight, gap, dream_id, at, session) VALUES ('mem_aaaaaaaaaaa1', 3, 'reflection', 1, 3, NULL, ?, 'rfl-1')", [at3 + 1_000]);
  db.run("UPDATE events SET at = ? WHERE name = 'recall.rated'", [at3 + 2_000]);
  db.close();
  const day3 = extract(copy, { env }).days[3]!.acts.map((a) => a.kind);
  expect(day3.indexOf("night-return")).toBeLessThan(day3.indexOf("use"));
});

test("an about reason reads back to its mark and what it was", () => {
  expect(parseAboutReason("me (was unmarked)")).toEqual({ mark: "me", was: "unmarked" });
  expect(parseAboutReason("work (was us): because")).toEqual({ mark: "work", was: "us" });
  expect(parseAboutReason("nonsense")).toBeNull();
});
