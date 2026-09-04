/**
 * `tools/demo/seed` — the synthetic store the launch screenshots come from.
 *
 * Two things this suite is for, and they are different jobs:
 *
 *   1. **The guard.** A seeder that can be pointed at `~/.counterparts` is a
 *      seeder that will one day overwrite the owner's memory. `store/paths.ts`
 *      does NOT refuse that path — `.counterparts` is where the real store lives —
 *      so the refusal is the tool's own, and it is tested before anything else.
 *   2. **The store is rich in the ways the five views read.** Every assertion
 *      below is either a count the task named or the ABSENCE of a specific
 *      absence marker in a section the seed is supposed to have filled. Asserting
 *      "(none yet)" appears nowhere would be wrong: a rich store still prints it
 *      for the honest absences (nothing is both permanent and constitutive; every
 *      identity row read cleanly), so every check names its own section.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`. The seeder takes its directory as an argument and reads no
 * environment, so nothing here can reach a real store even if `COUNTERPARTS_DATA_DIR`
 * were pointing at one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { Dashboard, NEVER, NONE, VIEWS } from "../src/adapters/dashboard/index.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { FORBIDDEN_ROOT_NAMES, Store, assertSafeDataDir } from "../src/core/store/index.js";
import { CAST, DAYS } from "../tools/demo/script.js";
import {
  DemoTargetRefused,
  REFUSED_ROOT_NAMES,
  assertDemoTarget,
  seedDemo,
  seedEmpty,
} from "../tools/demo/seed.js";
import type { SeedReport } from "../tools/demo/seed.js";

const ENV = "COUNTERPARTS_DATA_DIR";

let dirs: string[] = [];
let priorEnv: string | undefined;

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "counterparts-demo-test-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  priorEnv = process.env[ENV];
  dirs = [];
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function views(dir: string): Record<string, string> {
  const d = Dashboard.open({ dir, width: 100 });
  try {
    const out: Record<string, string> = {};
    for (const v of VIEWS) out[v] = d.render(v, {});
    return out;
  } finally {
    d.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The guard, before anything else
// ═══════════════════════════════════════════════════════════════════════════
describe("the seeder can never be pointed at a real store", () => {
  test("every refused root is refused, including ~/.counterparts", () => {
    for (const name of REFUSED_ROOT_NAMES) {
      const root = join(homedir(), name);
      for (const candidate of [root, join(root, "store"), join(root, "..", name, "deep")]) {
        expect(() => assertDemoTarget(candidate)).toThrow(DemoTargetRefused);
      }
    }
  });

  test("~/.counterparts is refused here even though the core's own guard allows it", () => {
    // The distinction this test exists for: `store/paths.ts` refuses ~/.bansai
    // and ~/.claude-engram and nothing else, so the live-store refusal is THIS
    // tool's and would go missing silently if it were dropped.
    //
    // Proved with the two PURE functions — the resolve-and-compare guard and the
    // list it reads — and NEVER by opening a store at that path. `Store.open` on
    // `~/.counterparts/x` would create a directory skeleton and a database
    // inside the owner's live memory, which is the exact accident the header of
    // `src/core/counterpart.ts` records happening once under `~/.bansai`.
    expect(() => assertSafeDataDir(join(homedir(), ".counterparts"))).not.toThrow();
    expect([...FORBIDDEN_ROOT_NAMES]).not.toContain(".counterparts");
    expect([...REFUSED_ROOT_NAMES]).toContain(".counterparts");
    expect(() => assertDemoTarget(join(homedir(), ".counterparts"))).toThrow(DemoTargetRefused);
  });

  test("a relative path is refused — there is no default directory", () => {
    expect(() => assertDemoTarget("demo-store")).toThrow(DemoTargetRefused);
  });

  test("a directory that already holds a store is refused, by marker", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "prose"), { recursive: true });
    expect(() => assertDemoTarget(dir)).toThrow(DemoTargetRefused);

    const other = tempDir();
    writeFileSync(join(other, "operational.sqlite"), "");
    expect(() => assertDemoTarget(other)).toThrow(DemoTargetRefused);
  });

  test("a fresh empty directory is accepted", () => {
    const dir = tempDir();
    expect(assertDemoTarget(dir)).toBe(dir);
  });

  test("seedDemo refuses rather than seeding when the guard refuses", async () => {
    await expect(seedDemo({ dir: join(homedir(), ".counterparts", "demo") })).rejects.toThrow(
      DemoTargetRefused,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The cast is fictional AND structurally mintable
// ═══════════════════════════════════════════════════════════════════════════
describe("the fictional cast", () => {
  test("no name is a token-subset of another — near collision would refuse a birth", () => {
    const names = [
      ...CAST.people,
      ...CAST.entities,
      ...CAST.places,
      ...CAST.skills,
    ].map((c) => c.name.toLowerCase());
    const tokens = names.map((n) => new Set(n.split(/\s+/)));
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < names.length; j++) {
        if (i === j) continue;
        const a = tokens[i] as Set<string>;
        const b = tokens[j] as Set<string>;
        const contained = [...a].every((t) => b.has(t));
        expect(`${names[i] ?? ""} ⊄ ${names[j] ?? ""}: ${contained}`).toBe(
          `${names[i] ?? ""} ⊄ ${names[j] ?? ""}: false`,
        );
      }
    }
  });

  test("the script covers thirty lived days, weekdays, strictly increasing", () => {
    expect(DAYS.length).toBe(30);
    const dates = DAYS.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The rich store — the counts the launch needs
// ═══════════════════════════════════════════════════════════════════════════
describe("the rich store", () => {
  // ONE seed for the whole block. The store is read-only from here on — every
  // test below opens the dashboard in observer mode, which writes nothing — and
  // re-seeding per test would spend thirty lived days seventeen times.
  let dir = "";
  let report: SeedReport;
  let rendered: Record<string, string>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "counterparts-demo-rich-"));
    report = await seedDemo({ dir });
    rendered = views(dir);
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  test("no deposit was refused — a silent refusal is how a seeder ships short", () => {
    expect(report.refusals).toEqual([]);
  });

  test("thirty lived days, advanced by real sleep cycles", () => {
    expect(report.livedDays).toBe(30);
  });

  test("at least sixty memories, across EVERY kind the physics registry knows", () => {
    expect(report.memories).toBeGreaterThanOrEqual(60);
    for (const kind of Object.keys(PHYSICS.KINDS)) {
      const n = (report.memoriesByKind as Record<string, number>)[kind] ?? 0;
      expect(`${kind}=${n > 0}`).toBe(`${kind}=true`);
    }
  });

  test("all three bands are populated", () => {
    for (const band of ["episodic", "semantic", "identity"]) {
      expect(`${band}>0: ${(report.memoriesByBand[band] ?? 0) > 0}`).toBe(`${band}>0: true`);
    }
  });

  test("at least five entities, with beliefs and current-state facts on them", () => {
    expect(report.entities).toBeGreaterThanOrEqual(5);
    expect(report.beliefs).toBeGreaterThanOrEqual(5);
    expect(report.currentState).toBeGreaterThanOrEqual(1);
  });

  test("two contested beliefs, credited challenges, and one actually revised", () => {
    expect(report.contestedBeliefs).toBeGreaterThanOrEqual(2);
    expect(report.pressureIncrements).toBeGreaterThanOrEqual(4);
    expect(report.revisedBeliefs).toBeGreaterThanOrEqual(1);
  });

  test("the fast half of revision fired too: a current-state row was replaced", () => {
    expect(report.replacedCurrentState).toBeGreaterThanOrEqual(1);
  });

  test("an identity band earned at consolidation, and a non-empty protected set", () => {
    expect(report.promoted).toBeGreaterThanOrEqual(1);
    expect(report.identityElements).toBeGreaterThanOrEqual(1);
    expect(report.protectedElements).toBeGreaterThanOrEqual(1);
  });

  test("at least six journal chapters", () => {
    expect(report.episodes).toBeGreaterThanOrEqual(6);
  });

  test("recall ran, and co-activation left edges", () => {
    expect(report.recallDecisions).toBeGreaterThan(0);
    expect(report.edges).toBeGreaterThan(0);
  });

  test("forgetting is visible: memories pruned at the floor and duplicates merged", () => {
    expect(report.pruned).toBeGreaterThanOrEqual(1);
    expect(report.merged).toBeGreaterThanOrEqual(1);
  });

  test("prospective intentions both fired and stayed pending", () => {
    expect(report.intentionsFired).toBeGreaterThanOrEqual(1);
    expect(report.intentionsPending).toBeGreaterThanOrEqual(1);
  });

  test("a wake briefing is composed and waiting", () => {
    expect(report.briefingBytes).toBeGreaterThan(0);
  });

  // ── the views, section by section ──────────────────────────────────────

  test("status: nothing that should be filled reads as empty", () => {
    const s = rendered["status"] ?? "";
    expect(s).not.toContain("I am holding nothing yet.");
    expect(s).not.toContain("No belief has ever taken a credited challenge.");
    expect(s).toContain("I have a briefing composed and waiting");
    // Every sleep phase has finished at least once: no phase row says NEVER.
    const cycle = section(s, "My last cycle", "Band symmetry");
    expect(cycle).not.toContain(NEVER);
    // No kind row and no band row is empty.
    expect(section(s, "By kind", "By band")).not.toContain(NONE);
    expect(section(s, "By band", "My last cycle")).not.toContain(NONE);
    // Forgetting is reported as numbers, not as an absence.
    expect(s).toMatch(/pruned\s+\d+\s+let go at the floor/);
    expect(s).toMatch(/merged\s+\d+\s+merged into a duplicate/);
  });

  test("browse: the list is not empty and names real memories", () => {
    const b = rendered["browse"] ?? "";
    expect(b).not.toContain(`${NONE} — nothing matches`);
    expect(b).toContain("strongest first");
    expect(b).toMatch(/mem_[0-9a-f]+/);
  });

  test("stories: a real pressure narrative, ending in a revision", () => {
    const st = rendered["stories"] ?? "";
    expect(st).not.toContain(`${NONE} — nothing I hold has been argued with`);
    expect(st).not.toContain(`${NONE} — this belief carries pressure but I hold no credited`);
    expect(st).toContain("Every credited challenge, in the order it landed");
    expect(st).toContain("REVISED, becoming");
    expect(st).toContain("held");
    // challenger, force, bar, verdict — the five things per beat.
    expect(st).toMatch(/day \d+\s+challenged by .+force \d/);
  });

  test("identity: both lists have rows", () => {
    const i = rendered["identity"] ?? "";
    expect(i).not.toContain(`${NONE} — this list is empty.`);
    expect(i).not.toContain("I hold 0 elements in the identity band");
    expect(i).toContain("Protected — permanent ink");
    expect(i).not.toContain(`${NONE} — every permanent element also stands in the identity band.`);
  });

  test("activity: the feed is not empty and the core's own events have counts", () => {
    const a = rendered["activity"] ?? "";
    expect(a).not.toContain(`${NONE} — my durable log is empty.`);
    expect(a).toContain("events I hold.");
    // The vocabulary block: every event the CORE writes has fired at least once.
    // The `adapter.*` names correctly still read NEVER — no host ran here.
    for (const name of [
      "band.promoted",
      "band.transition",
      "memory.pruned",
      "memory.merged",
      "recall.decision",
      "revision.pressure",
    ]) {
      const line = (a.split("\n").find((l) => l.trim().startsWith(name)) ?? "").trim();
      expect(`${name}: ${line.includes(NEVER) ? "never" : "fired"}`).toBe(`${name}: fired`);
    }
  });

  test("every view renders without throwing, and none is trivially short", () => {
    for (const v of VIEWS) {
      expect((rendered[v] ?? "").length).toBeGreaterThan(200);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The empty store — the other set of screenshots
// ═══════════════════════════════════════════════════════════════════════════
describe("the empty store", () => {
  test("all five views render, and say honestly that there is nothing", () => {
    const dir = tempDir();
    const report = seedEmpty({ dir });
    expect(report.mode).toBe("empty");
    expect(report.memories).toBe(0);

    const rendered = views(dir);
    for (const v of VIEWS) expect(typeof rendered[v]).toBe("string");
    expect(rendered["status"]).toContain("I am holding nothing yet.");
    expect(rendered["status"]).toContain(NEVER);
    expect(rendered["browse"]).toContain(`${NONE} — nothing matches`);
    expect(rendered["stories"]).toContain(`${NONE} — nothing I hold has been argued with`);
    expect(rendered["identity"]).toContain(`${NONE} — this list is empty.`);
    expect(rendered["activity"]).toContain(`${NONE} — my durable log is empty.`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Determinism
// ═══════════════════════════════════════════════════════════════════════════
describe("two runs build the same store", () => {
  /**
   * CONTENT-identical, not byte-identical, and the difference is not a
   * concession: ids are `randomBytes` at the store seam (`store/index.ts`) and
   * `learnedOn` defaults to the wall clock, neither of which a caller can pin.
   * So the digest is over what the seeder actually decides — every row's type,
   * kind and prose, sorted.
   */
  function contentDigest(dir: string): string {
    const store = Store.open({ dir, observer: true });
    try {
      const lines: string[] = [];
      for (const id of [...store.list({ archived: true }), ...store.list()]) {
        const row = store.row(id);
        if (row === undefined) continue;
        lines.push(`${row.type}|${row.kind}|${row.band}|${store.readProse(id).body}`);
      }
      lines.sort();
      return createHash("sha256").update(lines.join("\n ")).digest("hex");
    } finally {
      store.close();
    }
  }

  test("same content, same counts, from a fixed seed and a fixed clock", async () => {
    const a = tempDir();
    const b = tempDir();
    const ra = await seedDemo({ dir: a });
    const rb = await seedDemo({ dir: b });

    expect(contentDigest(a)).toBe(contentDigest(b));
    expect({ ...rb, dir: a }).toEqual({ ...ra, dir: a });
  }, 30_000); // two full 30-day seeds; 8.2 s was measured under suite load, against a 5 s default
});

/** The text between two headings, so an assertion names its own panel. */
function section(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  if (start < 0) return "";
  const end = text.indexOf(to, start + from.length);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}
