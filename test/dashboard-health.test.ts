/**
 * The health tab (2026-09-25 redesign): doctor as a checklist through the
 * actions seam, the last cycle as one line, and where archived memories went
 * as one picture.
 *
 * What this file proves:
 *
 *   1. `doctor` is an action that builds `doctor --dir <store> [--config] --json`
 *      and nothing else; opened on a bare store it arms the explicit-dir guard
 *      for that run, so the console grades the store alone and says so in its
 *      `config` line rather than reading a default configuration.
 *   2. Running it leaves the store byte-identical, and its output is the JSON
 *      the page draws.
 *   3. Every `archived_reason` the core writes has a plain phrase, the archive
 *      counts add up to the archived rows, and a reason nobody mapped still
 *      gets a segment.
 *   4. The cycle line on a store that has never slept says so.
 *
 * Hermetic (CLAUDE.md): every store and configuration lives in a fresh temp
 * dir removed afterwards; `home` is a temp dir too, so the host reading never
 * looks at a real `~/.claude`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Dashboard } from "../src/adapters/dashboard/index.js";
import { NO_CONFIG_HOME, buildArgv, runAction } from "../src/adapters/dashboard/web/actions.js";
import { ARCHIVE_PHRASES } from "../src/adapters/dashboard/web/views/archive-words.js";
// @ts-expect-error — a plain browser module, no declarations
import { PLAIN, lineOf } from "../src/adapters/dashboard/web/pages/health/sections/checks.js";
// @ts-expect-error — a plain browser module, no declarations
import { FULL_SHARE, wakeLine } from "../src/adapters/dashboard/web/pages/health/sections/wake.js";
import { healthView, pageCostOf, wakeCosts } from "../src/adapters/dashboard/web/views/health.js";
import type { WakeCosts } from "../src/adapters/dashboard/web/views/health.js";
import { pageTooLargeLine } from "../src/core/self/briefing.js";
import { truncationMarker } from "../src/core/self/page.js";
import { CORRECTED_REASON } from "../src/core/contradictions.js";
import { DREAM_MERGE_REASON, DREAM_UNDONE_REASON } from "../src/core/dream/index.js";
import { TUNABLES as SCHEMA_TUNABLES } from "../src/core/schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON, markerKey } from "../src/core/sleep/index.js";
import { PHASES } from "../src/core/sleep/types.js";
import { Store } from "../src/core/store/index.js";
import { REMOVED_REASON } from "../src/core/store/owner-op-seam.js";
import { seedDemo, seedEmpty } from "../tools/demo/seed.js";

let temps: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
beforeEach(() => {
  temps = [];
});
afterEach(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      const rel = relative(dir, full);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // As in dashboard-actions: box 3 is rewritten on every open, and `-shm`
      // takes read-marks from every WAL reader.
      if (rel.startsWith("cache") || entry.name.endsWith("-shm")) continue;
      if (!entry.isFile()) continue;
      out.set(rel, `${statSync(full).size}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

describe("doctor through the actions seam", () => {
  test("builds doctor --json on the dashboard's own store, and nothing from the body", () => {
    expect(buildArgv("doctor", { dir: "/elsewhere", config: "/x.json" }, { dir: "/tmp/s", config: "/tmp/c.json" })).toEqual({
      argv: ["doctor", "--dir", "/tmp/s", "--config", "/tmp/c.json", "--json"],
    });
  });

  test("opened on a bare store, every action arms the guard and names no configuration", () => {
    const bare = { dir: "/tmp/s" };
    const built = buildArgv("doctor", {}, bare);
    expect(built.argv).toEqual(["doctor", "--dir", "/tmp/s", "--json"]);
    expect(built.env).toEqual({ COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_CONFIG: undefined });
    // doctor keeps the real home (its host reading is ~/.claude); the rest get one with no configuration.
    expect(built.home).toBeUndefined();
    const bodies: Record<string, Record<string, unknown>> = {
      ask: { question: "what is on the rota?" },
      note: { text: "The allotment rota is pinned inside the shed door." },
      remove: { id: "mem_0123456789ab" },
      backup: { out: "/tmp/out" },
      export: { out: "/tmp/out" },
      rebrief: {},
      verify: {},
    };
    for (const [name, body] of Object.entries(bodies)) {
      const b = buildArgv(name as Parameters<typeof buildArgv>[0], body, bare);
      expect(`${name}: ${b.home}`).toBe(`${name}: ${NO_CONFIG_HOME}`);
      expect(b.env?.["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"]).toBe("1");
      expect("COUNTERPARTS_CONFIG" in (b.env ?? {})).toBe(true);
      expect(b.argv).not.toContain("--config");
    }
    // scope still refuses outright without one.
    expect(() => buildArgv("scope", { list: true }, bare)).toThrow("without one");
    // And with a configuration nothing is laid over the console.
    const withConfig = buildArgv("rebrief", {}, { dir: "/tmp/s", config: "/tmp/c.json" });
    expect(withConfig.env).toBeUndefined();
    expect(withConfig.home).toBeUndefined();
  });

  /**
   * THE HOLE THIS CLOSES (found by the Self builder, 2026-09-25): `rebrief`
   * from a dashboard opened on a bare `--dir` took its budget from the
   * owner's live `~/.counterparts/claude-code.json`. Here the "live" file is a
   * marker in a fake home the console is pointed at — both as `home` and as
   * `HOME` — with a budget no default would ever produce, and naming a store
   * that does not exist. Neither rebrief nor note may show a trace of it.
   */
  test("a bare-store dashboard's rebrief and note never read the default configuration", async () => {
    const root = tempDir("counterparts-health-nohome-");
    const seeded = seedEmpty({ dir: join(root, "store") });
    const home = join(root, "home");
    const live = join(home, ".counterparts", "claude-code.json");
    mkdirSync(join(home, ".counterparts"), { recursive: true });
    writeFileSync(live, JSON.stringify({ dataDir: join(root, "LIVE-STORE"), injectionBudgetBytes: 4321 }));
    const ctx = { dir: seeded.dir, home, env: { HOME: home, COUNTERPARTS_CONFIG: live } };

    const rebrief = await runAction("rebrief", {}, ctx);
    expect(rebrief.status).toBe(200);
    const said = [...(rebrief.body.out ?? []), ...(rebrief.body.err ?? [])].join("\n");
    expect(said).not.toContain("4321");
    expect(said).not.toContain(live);
    expect(said).not.toContain("LIVE-STORE");
    // With no configuration to take a budget from, rebrief refuses in its own
    // words ("Pass --budget …") rather than borrowing the live one's.
    expect(rebrief.body.exit).toBe(2);
    expect(said).toContain("--budget");
    // Given one on the page, it composes under exactly that.
    const budgeted = await runAction("rebrief", { budget: 9000 }, ctx);
    const saidB = [...(budgeted.body.out ?? []), ...(budgeted.body.err ?? [])].join("\n");
    expect(budgeted.body.exit).toBe(0);
    expect(saidB).toContain("9000");
    expect(saidB).not.toContain("4321");

    const note = await runAction("note", { text: "The boiler service is booked for the first Tuesday in March." }, ctx);
    expect(note.status).toBe(200);
    const noted = [...(note.body.out ?? []), ...(note.body.err ?? [])].join("\n");
    expect(note.body.exit).toBe(0);
    expect(noted).not.toContain(live);
    expect(noted).not.toContain("LIVE-STORE");
    // The note landed in the dashboard's store, and nothing appeared beside the marker.
    expect(noted).toContain(seeded.dir);
    expect(readdirSync(join(home, ".counterparts"))).toEqual(["claude-code.json"]);
    expect(existsSync(join(root, "LIVE-STORE"))).toBe(false);
  }, 60_000);

  test("a doctor run leaves the store byte-identical and answers in JSON", async () => {
    const root = tempDir("counterparts-health-doctor-");
    const dir = join(root, "store");
    await seedDemo({ dir });
    const config = join(root, "claude-code.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
    const home = join(root, "home");
    const before = snapshot(dir);
    const r = await runAction("doctor", {}, { dir, config, home, env: { HOME: home } });
    expect(r.status).toBe(200);
    // 0, or doctor's red exit — a red store is a reading, not a refusal.
    expect(typeof r.body.exit).toBe("number");
    const report = JSON.parse((r.body.out ?? []).join("\n")) as {
      findings: { key: string; severity: string; title: string; detail: string }[];
    };
    expect(report.findings.length).toBeGreaterThan(5);
    const store = report.findings.find((f) => f.key === "store");
    expect(store?.severity).toBe("green");
    expect(snapshot(dir)).toEqual(before);
  }, 60_000);

  test("without a configuration, doctor grades the store and names the config as not read", async () => {
    const root = tempDir("counterparts-health-bare-");
    const seeded = seedEmpty({ dir: join(root, "store") });
    const home = join(root, "home");
    const before = snapshot(seeded.dir);
    const r = await runAction("doctor", {}, { dir: seeded.dir, home, env: { HOME: home } });
    expect(r.status).toBe(200);
    const report = JSON.parse((r.body.out ?? []).join("\n")) as {
      findings: { key: string; data: Record<string, unknown> }[];
    };
    const config = report.findings.find((f) => f.key === "config");
    expect(config?.data["reason"]).toBe("not-read");
    expect(report.findings.some((f) => f.key === "store")).toBe(true);
    expect(snapshot(seeded.dir)).toEqual(before);
  }, 60_000);
});

describe("where archived memories went", () => {
  test("every archived_reason the core names has a plain phrase", () => {
    const mapped = new Set(ARCHIVE_PHRASES.map(([reason]) => reason));
    for (const reason of [
      PRUNE_ARCHIVE_REASON,
      MERGE_ARCHIVE_REASON,
      DREAM_MERGE_REASON,
      DREAM_UNDONE_REASON,
      SCHEMA_TUNABLES.FADE_REASON,
      SCHEMA_TUNABLES.REVISED_REASON,
      SCHEMA_TUNABLES.REPLACED_REASON,
      CORRECTED_REASON,
      REMOVED_REASON,
      "handoff-cleared",
      "handoff-duplicate",
      "episode-regrown",
      "supersede",
    ]) {
      expect(`${reason}: ${mapped.has(reason)}`).toBe(`${reason}: true`);
    }
    // And every reason the code hands the store's three archiving writers
    // today — `archive(id, reason)`, `supersede(old, input, reason = "supersede")`
    // and `supersedeInto(old, successor, reason)` — read off the call sites.
    // The first version of this check matched only `.archive(x, "literal")`
    // on one line, so a reason passed as a named constant, or to
    // `supersedeInto`, got past it: the health tab showed
    // "archived (dream-merge)" after 0.3.5 (2026-09-28).
    const written = archiveReasonsWritten(join(import.meta.dir, "..", "src"));
    expect(written.unresolved).toEqual([]);
    for (const reason of [DREAM_MERGE_REASON, DREAM_UNDONE_REASON, SCHEMA_TUNABLES.FADE_REASON, "revised-by-pressure"]) {
      expect(`${reason}: ${written.found.has(reason)}`).toBe(`${reason}: true`);
    }
    for (const reason of written.found) expect(`${reason}: ${mapped.has(reason)}`).toBe(`${reason}: true`);
  });

  test("the reason reader sees the call shapes the first check missed", () => {
    const dir = tempDir("counterparts-archive-reasons-");
    mkdirSync(join(dir, "core", "x"), { recursive: true });
    writeFileSync(
      join(dir, "core", "x", "a.ts"),
      [
        'export const SOME_REASON = "some-reason";',
        "export const TUNABLES = {",
        '  TUNED_REASON: "tuned-reason" as const,',
        "};",
        "store.archive(id, SOME_REASON);",
        'this.store.supersedeInto(a, b, "into-reason", { carryReturns: true });',
        "store.supersede(",
        "  old,",
        '  { type: "memory", body: f(x, y) },',
        '  "multi-line-reason",',
        ");",
        "store.supersede(old, { body });",
        "store.archive(id, TUNABLES.TUNED_REASON);",
        "store.archive(id, someVariable);",
      ].join("\n"),
    );
    const read = archiveReasonsWritten(dir);
    expect([...read.found].sort()).toEqual(["into-reason", "multi-line-reason", "some-reason", "supersede", "tuned-reason"]);
    expect(read.unresolved).toEqual([`${join("core", "x", "a.ts")}: someVariable`]);
  });

  test("the counts add up to the archived rows, and an unknown reason still gets a segment", async () => {
    const dir = join(tempDir("counterparts-health-archive-"), "store");
    await seedDemo({ dir });
    const w = Store.open({ dir });
    let target = "";
    try {
      target = w.list().find((id) => w.row(id)?.archived === 0 && id.startsWith("mem_")) ?? "";
      expect(target).not.toBe("");
      w.archive(target, "a-reason-nobody-mapped");
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const store = dash.source.store;
      const archived = store.list().filter((id) => store.row(id)?.archived === 1).length;
      const h = healthView(dash.source);
      expect(h.archive.total).toBe(archived);
      const unknown = h.archive.reasons.find((r) => r.reason === "a-reason-nobody-mapped");
      expect(unknown?.known).toBe(false);
      expect(unknown?.phrase).toContain("a-reason-nobody-mapped");
      expect(unknown?.items.map((i) => i.id)).toEqual([target]);
      // The three ways out by design are always on the legend, even at zero.
      for (const r of [PRUNE_ARCHIVE_REASON, MERGE_ARCHIVE_REASON, REMOVED_REASON]) {
        expect(h.archive.reasons.some((x) => x.reason === r)).toBe(true);
      }
    } finally {
      dash.close();
    }
  }, 60_000);

  test("a phase that simply was not due by its cadence is waiting, not behind (2026-09-27)", () => {
    const dir = join(tempDir("counterparts-health-cadence-"), "store");
    seedEmpty({ dir });
    const w = Store.open({ dir });
    try {
      for (const date of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]) w.advanceClock(date);
      const today = w.livedDay();
      for (const phase of PHASES) w.setMeta(markerKey(phase), String(today));
      w.setMeta(markerKey("consolidate"), String(today - 1)); // every 3 lived days: not due at the last cycle
      w.setMeta(markerKey("prune"), String(today - 2)); // every lived day: it was due and did not run
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const h = healthView(dash.source);
      const by = new Map(h.cycle.phases.map((p) => [p.phase, p]));
      expect(by.get("consolidate")?.state).toBe("waiting");
      expect(by.get("consolidate")?.nextInDays).toBe(2);
      expect(by.get("prune")?.state).toBe("behind");
      expect(by.get("decay")?.state).toBe("ran");
      expect(h.cycle.waiting).toBe(1);
      expect(h.cycle.ran).toBe(PHASES.length - 2);
    } finally {
      dash.close();
    }
  });

  test("the cycle line's 'when' is the newest sleep that did something, not a check that found nothing due (2026-10-01)", () => {
    const dir = join(tempDir("counterparts-health-cycle-at-"), "store");
    seedEmpty({ dir });
    let t = 1_000_000;
    const w = Store.open({ dir, now: () => t });
    const ran = { phase: "decay", status: "ran", reason: "ran" };
    const quiet = (phase: string) => ({ phase, status: "did-not-run", reason: "not-due" });
    const check = { reason: "ran", failed: 0, phases: [{ phase: "clock", status: "ran-nothing-found", reason: "same-day" }, quiet("decay"), quiet("prune")] };
    let sleptAt = 0;
    try {
      w.advanceClock("2026-09-01");
      const today = w.livedDay();
      for (const phase of PHASES) w.setMeta(markerKey(phase), String(today));
      t += 1_000;
      sleptAt = t;
      w.appendEvent({ name: "sleep.cycle", day: today, payload: { reason: "ran", failed: 0, phases: [{ phase: "clock", status: "ran", reason: "ran" }, ran] } });
      // Two checks after it, the newest rows of all.
      t += 3_600_000;
      w.appendEvent({ name: "sleep.cycle", day: today, payload: check });
      t += 3_600_000;
      w.appendEvent({ name: "sleep.cycle", day: today, payload: check });
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      expect(healthView(dash.source).cycle.at).toBe(sleptAt);
    } finally {
      dash.close();
    }
  });

  test("an archived memory rebuilt many times is one line, with how many times (2026-10-01)", () => {
    const dir = join(tempDir("counterparts-health-archive-dupes-"), "store");
    seedEmpty({ dir });
    let t = 1_000;
    const w = Store.open({ dir, now: () => (t += 1_000) });
    const chapter = "Launch week: the first install from npm, and what it was like.";
    const made: string[] = [];
    try {
      // Five copies of one chapter and two of another (each copy keeps its
      // chapter's episodeId), rebuilt and archived in turn, and one memory
      // archived for the same reason with its own words.
      for (let i = 0; i < 5; i += 1) made.push(w.put({ type: "memory", kind: "self", body: chapter, meta: { episodeId: "ep_launch" } }));
      for (let i = 0; i < 2; i += 1) made.push(w.put({ type: "memory", kind: "self", body: "The quiet week after launch.", meta: { episodeId: "ep_quiet" } }));
      made.push(w.put({ type: "memory", kind: "self", body: "A chapter of its own, archived once.", meta: { episodeId: "ep_once" } }));
      for (const id of made) w.archive(id, "episode-regrown");
      // Two DIFFERENT memories with the same words stay two lines.
      for (let i = 0; i < 2; i += 1) w.archive(w.put({ type: "memory", kind: "fact", body: "The same words, said twice by two memories." }), PRUNE_ARCHIVE_REASON);
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const r = healthView(dash.source).archive.reasons.find((x) => x.reason === "episode-regrown");
      expect(r?.count).toBe(8);
      expect(r?.listed).toBe(8);
      expect(r?.items.map((i) => [i.label, i.times])).toEqual([
        ["A chapter of its own, archived once.", 1],
        ["The quiet week after launch.", 2],
        [chapter, 5],
      ]);
      // Each line opens its newest copy.
      expect(r?.items[2]?.id).toBe(made[4]);
      const pruned = healthView(dash.source).archive.reasons.find((x) => x.reason === PRUNE_ARCHIVE_REASON);
      expect(pruned?.items.map((i) => i.times)).toEqual([1, 1]);
    } finally {
      dash.close();
    }
    const page = readFileSync(join(import.meta.dir, "../src/adapters/dashboard/web/pages/health/sections/archive.js"), "utf8");
    expect(page).toContain("timesNote(m)");
  });

  test("the folded doctor lines read through the same plain words as the rows: Lookups in words", () => {
    const say = PLAIN["lookups"] as (d: unknown, detail?: string) => string | null;
    // Doctor's verb ("looked up": `noteLookups` counts every one looked up,
    // whole or not), doctor's window, and doctor's nudge when none were.
    const detail = "last 14 lived days — dream: 3 looked up of 40 offered in part, over 2 nights; reflection: no reflection measured yet";
    expect(say({ dreamOffered: 40, dreamLooked: 3, dreamNights: 2, reflectionOffered: 0, reflectionLooked: 0, reflections: 0, floor: false }, detail)).toBe(
      "last 14 lived days — dreams: 3 of 40 shown only in part were looked up, over 2 nights; reflections: no reflection measured yet",
    );
    expect(say({ dreamOffered: 9, dreamLooked: 0, dreamNights: 1, reflectionOffered: 5, reflectionLooked: 1, reflections: 1, floor: true }, detail)).toBe(
      "last 14 lived days — dreams: 0 of 9 shown only in part were looked up, over 1 night; reflections: 1 of 5 shown only in part were looked up, over 1 reflection (at least: more rows than were read)",
    );
    expect(say({ dreamOffered: 9, dreamLooked: 0, dreamNights: 1, reflectionOffered: 0, reflectionLooked: 0, reflections: 0, floor: false }, detail)).toBe(
      "last 14 lived days — dreams: 0 of 9 shown only in part were looked up, over 1 night; reflections: no reflection measured yet. None looked up yet: if that holds, the lines may be too thin or the lookup unclear",
    );
    expect(say(undefined)).toBeNull();
    // A finding with no plain words keeps doctor's own detail.
    expect(lineOf({ key: "clock", data: {}, detail: "lived day 4 · 2026-09-04" })).toBe("lived day 4 · 2026-09-04");
  });

  test("a full wake is green and says it is normal; amber only names what being full cost (Mike, 2026-10-01)", () => {
    const none: WakeCosts = { page: null, handoffs: 0, lastHere: 0, work: 0, writerHeld: false };
    const at = (bytes: number, budget: number, costs = none, trimmed = 0) =>
      wakeLine({ ok: true, bytes, budget, parts: [], trimmed, trimmedFrom: trimmed > 0 ? ["nearby memories"] : [], costs });
    expect(at(8840, 8840)).toEqual({ tone: "green", line: "The wake is full — normal: 8.8 KB of 8.8 KB" });
    expect(at(8700, 8840).tone).toBe("green");
    expect(at(8000, 8840).line).toBe("The wake fits: 8.0 KB of 8.8 KB, 0.8 KB room left");
    expect(at(8840 - Math.ceil(8840 * FULL_SHARE), 8840).line).toContain("The wake fits");
    // What it cost, named, and amber.
    expect(at(8840, 8840, { page: { shown: 5800, whole: 7200 }, handoffs: 2, lastHere: 0, work: 0, writerHeld: true })).toEqual({
      tone: "amber",
      line: "The wake is full (8.8 KB of 8.8 KB), and it cost something: the self page was cut to fit (5.8 KB of 7.2 KB shown); 2 handoffs had no room at a session start; the page writer held back for lack of room",
    });
    expect(at(8840, 8840, { ...none, page: { shown: 0, whole: 7200 } }, 3).line).toBe(
      "The wake is full (8.8 KB of 8.8 KB), and it cost something: the self page was left out (7.2 KB)",
    );
    expect(at(4000, 9000, { ...none, handoffs: 1 })).toEqual({
      tone: "amber",
      line: "The wake has room (4.0 KB of 9.0 KB), but 1 handoff had no room at a session start",
    });
    // A "Last here" line dropped for room (durable since 2026-10-01).
    expect(at(8840, 8840, { ...none, lastHere: 1 })).toEqual({
      tone: "amber",
      line: 'The wake is full (8.8 KB of 8.8 KB), and it cost something: 1 "Last here" line had no room at a session start',
    });
    // Over its ceiling is still a fault.
    expect(at(9100, 9000).tone).toBe("amber");
  });

  test("what a full wake cost is read from existing records: the page's own marker, handoff no-room rows", () => {
    // The page: the exact words the core prints when it cuts or leaves out the page.
    expect(pageCostOf(`## Core\n\nShort.\n\n${truncationMarker(5800, 7200)}`)).toEqual({ shown: 5800, whole: 7200 });
    expect(pageCostOf(`Who I am:\n${pageTooLargeLine(7200)}`)).toEqual({ shown: 0, whole: 7200 });
    expect(pageCostOf("## Core\n\nA whole page.")).toBeNull();
    // Handoffs: distinct handoffs refused for room since the wake was rendered.
    const dir = join(tempDir("counterparts-health-wake-costs-"), "store");
    seedEmpty({ dir });
    const w = Store.open({ dir });
    let renderDay = 0;
    try {
      for (const date of ["2026-09-01", "2026-09-02", "2026-09-03"]) w.advanceClock(date);
      renderDay = w.livedDay();
      w.appendEvent({ name: "handoff.refused", day: renderDay - 1, ref: "hnd_old", payload: { reason: "no-room", bytes: 900, budget: 9000 } });
      w.appendEvent({ name: "handoff.refused", day: renderDay, ref: "hnd_a", payload: { reason: "no-room", bytes: 900, budget: 9000 } });
      w.appendEvent({ name: "handoff.refused", day: renderDay, ref: "hnd_b", payload: { reason: "no-room", bytes: 700, budget: 9000 } });
      w.appendEvent({ name: "handoff.refused", day: renderDay, ref: "hnd_c", payload: { reason: "too-large", bytes: 99_000 } });
      // "Last here" lines dropped for room: distinct chapters since the render.
      w.appendEvent({ name: "handoff.lasthere.noroom", day: renderDay - 1, ref: "epi_old", payload: { bytes: 900, budget: 9000, besideHandoff: false } });
      w.appendEvent({ name: "handoff.lasthere.noroom", day: renderDay, ref: "epi_a", payload: { bytes: 900, budget: 9000, besideHandoff: true } });
    } finally {
      w.close();
    }
    const dash = Dashboard.open({ dir });
    try {
      const c = wakeCosts(dash.source, "", renderDay);
      expect(c.handoffs).toBe(2);
      expect(c.lastHere).toBe(1);
      expect(c.page).toBeNull();
      expect(c.writerHeld).toBe(false);
    } finally {
      dash.close();
    }
  });

  test("a sparse store reads calmly: nothing archived, sleep has not run", () => {
    const seeded = seedEmpty({ dir: join(tempDir("counterparts-health-sparse-"), "store") });
    const dash = Dashboard.open({ dir: seeded.dir });
    try {
      const h = healthView(dash.source);
      expect(h.archive.total).toBe(0);
      expect(h.cycle.day).toBeNull();
      expect(h.cycle.ran).toBe(0);
      expect(h.cycle.phases.every((p) => p.state === "never")).toBe(true);
    } finally {
      dash.close();
    }
  });
});

/**
 * Every `archived_reason` the source under `root` hands the store's archiving
 * writers, read from the call sites. The reason argument — the second of
 * `.archive(`, the third of `.supersede(` and `.supersedeInto(` — is a string
 * literal, a named constant (`export const NAME = "…"` anywhere under `root`),
 * a `TUNABLES.NAME` (`NAME: "…"`), or `supersede`'s own default when it is left
 * off. Anything else is `unresolved` unless it is a pass-through named below,
 * so a new call shape fails the test instead of slipping by.
 */
function archiveReasonsWritten(root: string): { found: Set<string>; unresolved: string[] } {
  const files: { path: string; text: string }[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push({ path: relative(root, full), text: readFileSync(full, "utf8") });
    }
  };
  walk(root);
  const consts = new Map<string, string>();
  for (const f of files) {
    for (const m of f.text.matchAll(/export const ([A-Z][A-Z0-9_]*) = "([^"]+)"/g)) consts.set(m[1] as string, m[2] as string);
    for (const m of f.text.matchAll(/^\s+([A-Z][A-Z0-9_]*): "([^"]+)"(?: as const)?,/gm)) consts.set(`.${m[1] as string}`, m[2] as string);
  }
  // Reasons a caller forwards: `schemas/` revises under pressure and replaces
  // by declaration through one helper that hands `spec.reason` on, set from
  // TUNABLES.REVISED_REASON and TUNABLES.REPLACED_REASON — both checked by name
  // in the fixed list.
  const PASS_THROUGH = new Set([`${join("core", "schemas", "index.ts")}: spec.reason`]);
  const found = new Set<string>();
  const unresolved: string[] = [];
  for (const f of files) {
    if (f.path.startsWith(join("core", "store"))) continue; // the writers themselves
    for (const m of f.text.matchAll(/\.(archive|supersede|supersedeInto)\(/g)) {
      const args = topLevelArgs(f.text, (m.index as number) + m[0].length);
      if (args === null) continue;
      const method = m[1] as string;
      const arg = args[method === "archive" ? 1 : 2];
      if (arg === undefined) {
        if (method === "supersede" && args.length === 2) found.add("supersede");
        else unresolved.push(`${f.path}: .${method}(${args.join(", ").slice(0, 60)})`);
        continue;
      }
      const lit = /^"([^"]+)"$/.exec(arg);
      const member = /^[A-Za-z_]+(\.[A-Z][A-Z0-9_]*)$/.exec(arg);
      if (lit !== null) found.add(lit[1] as string);
      else if (consts.has(arg)) found.add(consts.get(arg) as string);
      else if (member !== null && consts.has(member[1] as string)) found.add(consts.get(member[1] as string) as string);
      else if (!PASS_THROUGH.has(`${f.path}: ${arg}`)) unresolved.push(`${f.path}: ${arg}`);
    }
  }
  return { found, unresolved };
}

/** The top-level arguments of a call whose `(` ends just before `from`; null when it never closes. */
function topLevelArgs(text: string, from: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = from;
  for (let i = from; i < text.length; i++) {
    const c = text[i] as string;
    if (quote !== null) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0) {
        const last = text.slice(start, i).trim();
        if (last.length > 0) args.push(last);
        return args;
      }
      depth -= 1;
    } else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}
