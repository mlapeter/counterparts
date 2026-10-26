/**
 * `mechanisms` — the short view over the what-fired reading, against real temp
 * stores.
 *
 * What it keeps: one line per memory mechanism with the light its evidence
 * earns, a plumbing line that names only what is genuinely failing, `fired` as
 * the same command under its older name, and `--all` as the full `fired`
 * report, unchanged.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp dir per test, removed in
 * `afterEach`, and the store's provenance clock injected.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { Store, paths } from "../src/core/store/index.js";
import { Schemas } from "../src/core/schemas/index.js";
import { MECHANISMS, daysBefore, firedReport } from "../src/adapters/fired.js";
import { MEMORY_MECHANISMS } from "../src/adapters/cli/mechanisms.js";
import { firedLines } from "../src/adapters/cli/commands.js";
import { run } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import { router } from "../src/adapters/dashboard/web/server.js";
import { mechanismsView } from "../src/adapters/dashboard/web/views/mechanisms.js";
// @ts-expect-error a browser module, plain JS
import { picture as schemaPicture } from "../src/adapters/dashboard/web/mechanisms/schema/panel.js";
import { stripV14 } from "./store-fixture.js";

const TODAY = "2026-09-17";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-mechanisms-"));
  dir = join(root, "store");
  Counterpart.open({ dir }).close();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function at(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** Append durable rows, each stamped with a calendar date, and close. */
function seed(rows: readonly [name: string, date: string, payload?: Record<string, unknown>][]): void {
  const s = Store.open({ dir, now: () => at(TODAY) });
  try {
    for (const [name, date, payload] of rows) {
      s.appendEvent({ name, day: s.livedDay(), payload: { date, ...(payload ?? {}) } });
    }
  } finally {
    s.close();
  }
}

async function console_(argv: readonly string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await run([...argv, "--dir", dir], {
    io: { out: (l) => out.push(l), err: (l) => out.push(l) },
    now: () => at(TODAY),
  });
  return { code, out };
}

/** The mechanism lines, by name → the light that opens them. */
function lights(out: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of out) {
    const m = /^([●◐○]) (\S+)/u.exec(line);
    if (m === null || !MEMORY_MECHANISMS.some((x) => x.name === m[2])) continue;
    found.set(m[2] ?? "", m[1] ?? "");
  }
  return found;
}

function lineFor(out: readonly string[], name: string): string {
  return out.find((l) => /^[●◐○] /u.test(l) && l.slice(2).startsWith(name)) ?? "";
}

describe("the table", () => {
  test("every id it names is a row of MECHANISMS", () => {
    const known = new Set(MECHANISMS.map((m) => m.id));
    for (const id of MEMORY_MECHANISMS.flatMap((m) => m.evidence)) expect(known.has(id), id).toBe(true);
  });

  test("twelve mechanisms, in the site's four groups and order (Dreaming beside Consolidation since 2026-09-26)", () => {
    expect(MEMORY_MECHANISMS.map((m) => `${m.group}:${m.name}`)).toEqual([
      "Encoding:Salience",
      "Encoding:Emotion",
      "Storage:Forgetting",
      "Storage:Interference",
      "Retrieval:Retrieval",
      "Retrieval:Association",
      "Retrieval:Prospective",
      "Transformation:Consolidation",
      "Transformation:Dreaming",
      "Transformation:Reconsolidation",
      "Transformation:Schemas",
      "Transformation:Gist",
    ]);
  });
});

describe("counterparts mechanisms", () => {
  test("one line per mechanism, each with the light its evidence earns", async () => {
    seed([
      ["gate.deposit", TODAY, { accepted: 1 }],
      ["gate.deposit", daysBefore(TODAY, 2), { accepted: 1 }],
      ["recall.decision", TODAY, { surfacedCount: 2 }],
      ["recall.credit", TODAY, { reason: "credited", credited: 1 }],
      ["band.transition", TODAY, { site: "decay", direction: "down" }],
      ["band.promoted", TODAY],
    ]);
    const { code, out } = await console_(["mechanisms"]);
    expect(code).toBe(0);
    expect(out[0]).toContain("Memory mechanisms — last 7 days");
    expect(Object.fromEntries(lights(out))).toEqual({
      Salience: "●",
      Emotion: "◐",
      Forgetting: "●",
      // Partly built since 2026-09-29 (merges, flags, the changed fade): idle here.
      Interference: "◐",
      Retrieval: "●",
      Association: "◐",
      // Built, holding nothing dated: idle, never "not built" (2026-09-26).
      Prospective: "◐",
      Consolidation: "●",
      Dreaming: "◐",
      Reconsolidation: "◐",
      // Built since wave 2; read off its rows since 2026-10-26. No beliefs here: idle.
      Schemas: "◐",
      // Partly built since 2026-09-26: a dream writes a gist.
      Gist: "◐",
    });
    expect(lineFor(out, "Salience")).toContain("2 memories written and scored");
    expect(lineFor(out, "Retrieval")).toContain("1 turn brought memories to mind; 1 memory used and strengthened");
    expect(lineFor(out, "Consolidation")).toContain("1 memory became core");
    expect(lineFor(out, "Association")).toContain("no links formed");
    expect(lineFor(out, "Forgetting")).toContain("nothing at the floor yet");
    // Short: about fifteen lines, not a wall.
    expect(out.length).toBeLessThanOrEqual(20);
  });

  test("evidence older than the window reads as built, not firing", async () => {
    seed([["gate.deposit", daysBefore(TODAY, 10), { accepted: 1 }]]);
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Salience")).toBe("◐");
    expect(lineFor(out, "Salience")).toContain("built, not firing yet");
  });

  test("a row that lands whether or not the mechanism acted lights nothing (the shared rule, 2026-09-26)", async () => {
    // A cycle that promoted, faded and merged nothing; a deposit that accepted
    // nothing; a flush that wrote no link; a turn that brought nothing to mind.
    seed([
      ["sleep.cycle", TODAY, { faded: 0 }],
      ["gate.deposit", TODAY, { accepted: 0 }],
      ["associate.flush", TODAY, { rows: 0 }],
      ["recall.decision", TODAY, { surfacedCount: 0, footnoteCount: 0 }],
    ]);
    const { out } = await console_(["mechanisms"]);
    for (const name of ["Salience", "Forgetting", "Retrieval", "Association", "Consolidation"]) {
      expect(`${name}: ${lights(out).get(name)}`).toBe(`${name}: ◐`);
    }
  });

  test("the plumbing is one line, and good-news silence never reads as failing", async () => {
    // A copy that could not be made — but ten days ago, outside the window.
    seed([
      ["adapter.boundary", TODAY],
      ["snapshot.taken", TODAY],
      ["snapshot.failed", daysBefore(TODAY, 10), { step: "copy", reason: "ENOSPC" }],
    ]);
    const { out } = await console_(["mechanisms"]);
    const plumbing = out.filter((l) => l.startsWith("Plumbing:"));
    expect(plumbing).toEqual(["Plumbing: 2 parts running, none failing."]);
    const text = out.join("\n");
    expect(text).not.toContain("NEVER");
    expect(text).not.toContain("could not be made");
    expect(text).toContain("counterparts mechanisms --all");
  });

  test("a failure inside the window is named on the plumbing line", async () => {
    seed([
      ["snapshot.failed", TODAY, { step: "copy", reason: "ENOSPC" }],
      ["adapter.spawn.failed", TODAY, { reason: "SPAWN_FAILED" }],
    ]);
    const { out } = await console_(["mechanisms"]);
    const plumbing = out.find((l) => l.startsWith("Plumbing:")) ?? "";
    expect(plumbing).toContain("failing this week:");
    expect(plumbing).toContain("a copy of the store could not be made");
    expect(plumbing).toContain("the background worker failed or was refused");
  });

  test("a plain reminder due on a day a session ran and not said is never 'nothing due' (2026-10-09)", async () => {
    let clock = at("2026-09-12");
    const s = Store.open({ dir, now: () => clock });
    try {
      s.put({
        type: "memory",
        kind: "fact",
        body: "Renew the parking permit — asked to be told on the day.",
        learnedOn: "2026-09-12",
        eventDate: "2026-09-15",
        meta: { remind: "plain" },
      });
      clock = at("2026-09-15");
      s.appendEvent({ name: "recall.decision", day: s.livedDay(), payload: { date: "2026-09-15", reason: "rendered" } });
      s.appendEvent({ name: "physics.upgrade.census", day: s.livedDay(), payload: { date: "2026-09-02" } });
    } finally {
      s.close();
    }
    const short = await console_(["mechanisms"]);
    const line = lineFor(short.out, "Prospective");
    expect(line).toContain("1 plain reminder due on a day a session ran and not said");
    expect(line).not.toContain("nothing due");
    // The full report names it before the groups, and has the two new groups.
    const all = (await console_(["mechanisms", "--all"])).out.join("\n");
    expect(all).toContain("Its occasion came this week and it did not fire: a reminder marked plain");
    expect(all).toContain("WAITING (");
    expect(all).toContain("DONE (1)");
  });

  test("`fired` is the same command under its older name", async () => {
    seed([["gate.deposit", TODAY], ["recall.decision", TODAY]]);
    const a = await console_(["mechanisms"]);
    const b = await console_(["fired"]);
    expect(b.code).toBe(0);
    expect(b.out).toEqual(a.out);
  });

  test("--all is the full fired report, unchanged, under either name", async () => {
    seed([
      ["adapter.boundary", TODAY],
      ["sweep.gate", daysBefore(TODAY, 8), { refusals: { NO_CRASHED_SESSION: 3 } }],
    ]);
    const s = Store.open({ dir, observer: true, now: () => at(TODAY) });
    let expected: string[];
    try {
      // The console reads on the person's day, the store's `today()` — not the
      // UTC date TODAY spells, which is a day behind it at UTC+14.
      expected = firedLines(firedReport(s, s.today()), true);
    } finally {
      s.close();
    }
    const a = await console_(["mechanisms", "--all"]);
    const b = await console_(["fired", "--all"]);
    expect(a.out).toEqual(expected);
    expect(b.out).toEqual(expected);
    expect(a.out.join("\n")).toContain("what has fired —");
  });
});

/**
 * SCHEMAS (2026-10-26): the row said "not built" while the night formed
 * beliefs. It reads the rows a belief leaves now — its birth route and lived
 * birth day, and each memory filed for or against it — through the console.
 */
describe("Schemas: beliefs formed and the memories filed for them", () => {
  /** A store lived through enough days that the window has an outside. */
  function beliefStore(build: (s: Store, schemas: Schemas, today: number) => void): void {
    const s = Store.open({ dir, now: () => at(TODAY) });
    try {
      for (let d = 1; d <= 16; d++) s.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
      const schemas = Schemas.open({ store: s });
      build(s, schemas, s.livedDay());
    } finally {
      s.close();
    }
  }

  function lived(s: Store, body: string, day: number): string {
    return s.put({ type: "memory", kind: "fact", body, physics: { birthDay: day, lastUsedDay: day }, origin: { session: `sess-${String(day)}`, scope: `/work/${String(day)}` } });
  }

  test("no beliefs: built, idle, and it says there are none yet", async () => {
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("◐");
    expect(lineFor(out, "Schemas")).toContain("built, not firing yet: no beliefs yet");
    expect(out.join("\n")).not.toContain("not built yet:");
  });

  test("a belief born in the window, with memories filed for and against it: working, with the counts", async () => {
    beliefStore((s, schemas, today) => {
      const me = schemas.ensureSelfSubject();
      const a = lived(s, "I asked for the plan in short steps again.", today);
      const b = lived(s, "Short steps made the release go smoothly.", today);
      const c = lived(s, "A long plan in one go worked fine yesterday.", today);
      const born = schemas.addBelief({ entityId: me, statement: "We work best in short steps.", day: today, birthRoute: "reflection", channel: "authored", groundedIn: [a] });
      expect(born.ok).toBe(true);
      const id = born.id as string;
      expect(schemas.fileSupport({ beliefId: id, memoryId: a, stance: "support", day: today }).ok).toBe(true);
      expect(schemas.fileSupport({ beliefId: id, memoryId: b, stance: "support", day: today }).ok).toBe(true);
      expect(schemas.fileSupport({ beliefId: id, memoryId: c, stance: "contrary", day: today }).ok).toBe(true);
      // And one adopted from a dream's candidate.
      const d = lived(s, "The owner reviews diffs before merging.", today);
      const adopted = schemas.addBelief({ entityId: me, statement: "Reviews come before merges here.", day: today, birthRoute: "dream", channel: "authored", groundedIn: [d] });
      expect(schemas.fileSupport({ beliefId: adopted.id as string, memoryId: d, stance: "support", day: today }).ok).toBe(true);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("●");
    expect(lineFor(out, "Schemas")).toContain("1 belief formed, 1 belief adopted from a dream, 3 memories filed as support (1 against); 2 beliefs held");
    // The full report counts the same rows, dated by the moment each was written.
    const s = Store.open({ dir, observer: true });
    try {
      const rows = new Map(firedReport(s, TODAY).rows.map((r) => [r.id, r]));
      expect(rows.get("belief-birth")?.state).toBe("firing");
      expect(rows.get("belief-birth")?.firedInWindow).toBe(2);
      expect(rows.get("belief-support")?.state).toBe("firing");
      expect(rows.get("belief-support")?.firedInWindow).toBe(4);
    } finally {
      s.close();
    }
  });

  test("a belief older than the window: built, not firing this week, and still held", async () => {
    beliefStore((s, schemas) => {
      const me = schemas.ensureSelfSubject();
      const a = lived(s, "I asked for the plan in short steps.", 1);
      const born = schemas.addBelief({ entityId: me, statement: "We work best in short steps.", day: 1, birthRoute: "reflection", channel: "authored", groundedIn: [a] });
      expect(schemas.fileSupport({ beliefId: born.id as string, memoryId: a, stance: "support", day: 1 }).ok).toBe(true);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("◐");
    expect(lineFor(out, "Schemas")).toContain("built, not firing this week: no belief formed and no memory filed for or against one; 1 belief held");
  });

  test("a belief carried from v1 is held, never counted as formed", async () => {
    beliefStore((_s, schemas, today) => {
      const me = schemas.ensureSelfSubject();
      expect(schemas.addBelief({ entityId: me, statement: "I keep notes short.", day: today, birthRoute: "migrated", channel: "migrated" }).ok).toBe(true);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("◐");
    expect(lineFor(out, "Schemas")).toContain("1 belief held");
  });
});

/**
 * SCHEMAS, THE AWKWARD STATES (review of #629, 2026-10-26): the window's
 * edge on both surfaces, a belief born before the window and backed inside
 * it, a retired belief, a store from before v14, and the dashboard's picture
 * on a store with no belief formed here.
 */
describe("Schemas: the awkward states", () => {
  let clock = 0;
  function moving(build: (s: Store, schemas: Schemas, day: (date: string) => number) => void): void {
    const s = Store.open({ dir, now: () => clock });
    try {
      const day = (date: string): number => {
        clock = at(date);
        s.advanceClock(date);
        return s.livedDay();
      };
      build(s, Schemas.open({ store: s }), day);
    } finally {
      s.close();
    }
  }
  function lived(s: Store, body: string, day: number): string {
    return s.put({ type: "memory", kind: "fact", body, physics: { birthDay: day, lastUsedDay: day }, origin: { session: `sess-${String(day)}`, scope: `/work/${String(day)}` } });
  }
  function dashboard<T>(read: (src: DashboardSource) => T): T {
    const d = Dashboard.open({ dir });
    try {
      return read(d.source);
    } finally {
      d.close();
    }
  }
  const schemaLight = () => dashboard((src) => mechanismsView(src).mechanisms.find((m) => m.id === "schema"));
  const schemaPanel = () =>
    dashboard(
      (src) =>
        JSON.parse(router(new URL("http://localhost/api/mechanism?id=schema"), "localhost", src).body) as {
          built: boolean;
          picture: { kind: string; beliefs: { id: string; support: number; against: number }[] };
        },
    );
  function firedStates(): Record<string, string> {
    const s = Store.open({ dir, observer: true });
    try {
      return Object.fromEntries(firedReport(s, TODAY).rows.filter((r) => r.id.startsWith("belief-")).map((r) => [r.id, r.state]));
    } finally {
      s.close();
    }
  }

  test("a belief born seven days back, used daily: outside the week on the console, the dashboard and `fired` alike", async () => {
    moving((s, schemas, day) => {
      for (let d = 1; d <= 10; d++) day(`2026-09-${String(d).padStart(2, "0")}`);
      const me = schemas.ensureSelfSubject();
      const born = s.livedDay();
      const a = lived(s, "I asked for the plan in short steps.", born);
      const b = schemas.addBelief({ entityId: me, statement: "We work best in short steps.", day: born, birthRoute: "reflection", channel: "authored", groundedIn: [a] });
      expect(schemas.fileSupport({ beliefId: b.id as string, memoryId: a, stance: "support", day: born }).ok).toBe(true);
      for (let d = 11; d <= 17; d++) day(`2026-09-${String(d)}`);
      expect(s.livedDay() - born).toBe(7);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("◐");
    expect(lineFor(out, "Schemas")).toContain("built, not firing this week");
    const light = schemaLight();
    expect(light?.status).toBe("amber");
    // It has formed a belief before: never "no record of it firing yet".
    expect(light?.evidence).toBe("Built, but quiet for 7 days of use. 1 belief held.");
    expect(firedStates()).toEqual({ "belief-birth": "quiet", "belief-support": "quiet" });
  });

  test("born before the window and backed inside it: working on support alone, not formed", async () => {
    moving((s, schemas, day) => {
      for (let d = 1; d <= 9; d++) day(`2026-09-0${String(d)}`);
      const me = schemas.ensureSelfSubject();
      const old = s.livedDay();
      const a = lived(s, "I asked for the plan in short steps.", old);
      const id = schemas.addBelief({ entityId: me, statement: "We work best in short steps.", day: old, birthRoute: "reflection", channel: "authored", groundedIn: [a] }).id as string;
      expect(schemas.fileSupport({ beliefId: id, memoryId: a, stance: "support", day: old }).ok).toBe(true);
      for (let d = 10; d <= 17; d++) day(`2026-09-${String(d)}`);
      const now = s.livedDay();
      const c = lived(s, "Short steps made the release go smoothly.", now);
      expect(schemas.fileSupport({ beliefId: id, memoryId: c, stance: "support", day: now }).ok).toBe(true);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lights(out).get("Schemas")).toBe("●");
    expect(lineFor(out, "Schemas")).toContain("1 memory filed as support (0 against); 1 belief held");
    expect(lineFor(out, "Schemas")).not.toContain("formed");
    expect(schemaLight()?.status).toBe("green");
    expect(firedStates()).toEqual({ "belief-birth": "quiet", "belief-support": "firing" });
  });

  test("a retired belief is not held, its filings are not counted, and it is not pictured", async () => {
    let kept = "";
    moving((s, schemas, day) => {
      const now = day("2026-09-17");
      const me = schemas.ensureSelfSubject();
      const a = lived(s, "I asked for the plan in short steps.", now);
      const e = lived(s, "Mornings went to meetings all week.", now);
      kept = schemas.addBelief({ entityId: me, statement: "We work best in short steps.", day: now, birthRoute: "reflection", channel: "authored", groundedIn: [a] }).id as string;
      const gone = schemas.addBelief({ entityId: me, statement: "Mornings are for writing.", day: now, birthRoute: "session", channel: "authored", groundedIn: [a] }).id as string;
      expect(schemas.fileSupport({ beliefId: kept, memoryId: a, stance: "support", day: now }).ok).toBe(true);
      expect(schemas.fileSupport({ beliefId: gone, memoryId: e, stance: "contrary", day: now }).ok).toBe(true);
      // A retire lands as an archive (`settle` corrected); its rows stay.
      s.archive(gone, "settled");
      expect(s.supportOf(gone)).toHaveLength(1);
    });
    const { out } = await console_(["mechanisms"]);
    expect(lineFor(out, "Schemas")).toContain("1 belief formed, 1 memory filed as support (0 against); 1 belief held");
    expect(schemaPanel().picture.beliefs.map((b) => [b.id, b.support, b.against])).toEqual([[kept, 1, 0]]);
  });

  test("a store from before v14 (no belief_support, no birth_route): every surface reads it, none throws", async () => {
    moving((s, _schemas, day) => {
      day("2026-09-16");
      s.put({ type: "memory", kind: "fact", body: "The standup moved to nine." });
    });
    const db = new Database(paths.operational(dir));
    stripV14(db);
    db.run("UPDATE meta SET value = '13' WHERE key = 'schemaVersion'");
    db.close();
    expect(firedStates()).toEqual({ "belief-birth": "new", "belief-support": "new" });
    expect(schemaLight()?.status).toBe("waiting");
    const panel = schemaPanel();
    expect(panel.built).toBe(true);
    expect(panel.picture).toEqual({ kind: "schema", beliefs: [] });
    const { code, out } = await console_(["mechanisms"]);
    expect(code).toBe(0);
    expect(lineFor(out, "Schemas")).toContain("built, not firing yet: no beliefs yet");
  });

  test("the dashboard picture with no belief formed here: empty, said plainly, and a belief carried from v1 is not pictured", () => {
    expect(schemaPanel().picture).toEqual({ kind: "schema", beliefs: [] });
    expect(schemaPicture(null)).toContain("No belief has formed here yet.");
    expect(schemaPicture({ beliefs: [] })).toContain("No belief has formed here yet.");
    moving((_s, schemas, day) => {
      const now = day("2026-09-16");
      expect(schemas.addBelief({ entityId: schemas.ensureSelfSubject(), statement: "I keep notes short.", day: now, birthRoute: "migrated", channel: "migrated" }).ok).toBe(true);
    });
    expect(schemaPanel().picture.beliefs).toEqual([]);
    expect(schemaLight()?.evidence).toContain("1 belief held");
  });
});
