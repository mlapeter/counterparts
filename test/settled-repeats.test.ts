/**
 * SETTLED THINGS REPEATED (2026-10-22, lane R) — `counterparts mechanisms`'
 * line and its `--json`, read through the CLI door on a store built through
 * the real ones: pairs settled by `remember` with `updates`, an undo by
 * `counterparts settle --undo`, a later `drewOn` on `session_end` naming the
 * losing side (credited when it was shown, refused when it was archived — the
 * session said it drew on it either way), a later `updates … how: open` that
 * names a loser again, and a new memory that says a corrected thing again.
 * The harness column reads the same function over the whole record.
 *
 * Hermetic: a fresh temp dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { PRE_STAMP, settledLines, settledReading } from "../src/adapters/cli/mechanisms.js";
import type { SettledReading } from "../src/adapters/cli/mechanisms.js";
import { Counterpart } from "../src/core/counterpart.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { runningBuild } from "../src/core/store/index.js";
import { readRecord } from "../tools/harness/compare.js";
import { settledOf } from "../tools/harness/settled.js";

const SESSION = "sess_settled";
let root: string;
let dir: string;
let clock = 0;
const noon = (date: string): number => Date.parse(`${date}T12:00:00Z`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-settled-"));
  dir = join(root, "store");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function brain(): Counterpart {
  return Counterpart.open({ dir, now: () => clock, timeZone: "UTC" });
}

function server(c: Counterpart): McpServer {
  return new McpServer({ counterpart: c, session: SESSION, scope: "/scope/settled", registryDir: join(root, "registry"), now: () => clock });
}

function day(c: Counterpart, date: string): void {
  clock = noon(date);
  c.store.advanceClock(date);
}

async function remember(s: McpServer, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await s.call("remember", args)).structuredContent;
}

function idOf(out: Record<string, unknown>): string {
  const id = out["id"];
  if (typeof id !== "string") throw new Error(`no id in ${JSON.stringify(out)}`);
  return id;
}

/** Record `ids` as footnoted to the session on `turn`, as recall's own save would. */
function shown(c: Counterpart, turn: number, ids: readonly string[]): void {
  const prior = loadGateState(c.store, SESSION).state;
  const surfaced: GateState["surfaced"] = { ...prior.surfaced };
  for (const id of ids) surfaced[id] = { turn, tier: "footnoted", trains: true };
  saveGateState(c.store, { ...freshGateState(SESSION), ...prior, turn, lastDay: c.store.livedDay(), surfaced }, 200);
}

async function cli(argv: readonly string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await run([...argv, "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => out.push(l) }, now: () => clock });
  return { code, out };
}

function pairOver(c: Counterpart, over: string): string {
  const p = c.store.contradictions({ limit: 100 }).find((r) => r.over === over);
  if (p === undefined) throw new Error(`no pair over ${over}`);
  return p.id;
}

/**
 * The world: on 10-04 three pairs settled — a correction (the build time), a
 * change (the deploy day), and one undone at once; on 10-12, inside the week,
 * a session draws on the changed loser and names the archived one, a new
 * write reopens the deploy question, and a new memory says the old build
 * time again.
 */
async function world(): Promise<{ build: string; deploy: string; undone: string; buildOld: string; deployOld: string; undoneOld: string }> {
  const c = brain();
  try {
    const s = server(c);
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) day(c, d);
    const buildOld = idOf(await remember(s, { text: "The full build of the counterparts repo takes eight minutes on the laptop." }));
    const deployOld = idOf(await remember(s, { text: "The staging deploy runs every Monday morning after the standup." }));
    const undoneOld = idOf(await remember(s, { text: "The office plants are watered on Fridays by whoever is in." }));
    day(c, "2026-10-04");
    await remember(s, { text: "The full build takes eleven minutes, not eight: I misread the old logs.", updates: buildOld, how: "corrected" });
    await remember(s, { text: "I used to deploy staging on Mondays; now the staging deploy runs on Tuesday mornings.", updates: deployOld, how: "changed" });
    await remember(s, { text: "The office plants are watered on Wednesdays now, not Fridays.", updates: undoneOld, how: "changed" });
    return { build: pairOver(c, buildOld), deploy: pairOver(c, deployOld), undone: pairOver(c, undoneOld), buildOld, deployOld, undoneOld };
  } finally {
    c.close();
  }
}

async function laterWeek(w: Awaited<ReturnType<typeof world>>): Promise<void> {
  const c = brain();
  try {
    const s = server(c);
    for (const d of ["2026-10-08", "2026-10-12"]) day(c, d);
    // The changed loser shown and drawn on (credited); the corrected loser named (refused: archived);
    // the undone pair's loser drawn on too — it is no pair any more, so it counts for nothing.
    shown(c, 1, [w.deployOld, w.undoneOld]);
    const end = (await s.call("session_end", { session: SESSION, memories: [], drewOn: [w.deployOld, w.buildOld, w.undoneOld] })).structuredContent;
    expect((end["drewOn"] as Record<string, unknown>)["credited"]).toEqual(expect.arrayContaining([w.deployOld]));
    // The deploy question back again, naming its loser.
    await remember(s, { text: "Staging deploys on Mondays still come up; we disagree on whether Tuesday is right.", updates: w.deployOld, how: "open" });
    // The corrected thing said again, in the same words.
    await remember(s, { text: "The full build of the counterparts repo takes eight minutes on the laptop, as before." });
  } finally {
    c.close();
  }
}

describe("settled things repeated — `counterparts mechanisms`", () => {
  test("the line counts a repeat, a re-raise and a restatement, and leaves an undone settle out", async () => {
    const w = await world();
    {
      clock = noon("2026-10-04");
      const r = await cli(["settle", "--undo", w.undone, "--why", "it was right after all"]);
      expect(r.code).toBe(0);
    }
    await laterWeek(w);
    clock = noon("2026-10-12");
    const { code, out } = await cli(["mechanisms"]);
    expect(code).toBe(0);
    const line = out.find((l) => l.startsWith("Settled things repeated:"));
    expect(line).toBe("Settled things repeated: 2 of 2 pairs this week (re-raised 2; shown only 0)");
    const split = out.find((l) => l.startsWith("  by build:"));
    expect(split).toContain(`${runningBuild()} 2 repeated, 2 re-raised, 0 shown only`);

    const j = await cli(["mechanisms", "--json"]);
    expect(j.code).toBe(0);
    const doc = JSON.parse(j.out.join("\n")) as { settled: SettledReading; mechanisms: unknown[] };
    expect(doc.mechanisms.length).toBeGreaterThan(0);
    const st = doc.settled;
    expect(st.from).toBe("2026-10-06");
    expect(st.to).toBe("2026-10-12");
    expect(st.pairs).toBe(2);
    expect(st.repeatVia).toEqual({ drewOn: 2, quoted: 0, rated: 0, cited: 0 });
    expect(st.reraisedVia).toEqual({ loser: 1, winner: 0, restated: 1 });
    expect(st.examples.repeats.map((e) => e.pair).sort()).toEqual([w.build, w.deploy].sort());
    expect(st.examples.reraised.map((e) => e.pair).sort()).toEqual([w.build, w.deploy].sort());
    // Ids only: no example carries a body.
    expect(JSON.stringify(st)).not.toContain("minutes");
    // The undone pair is nowhere.
    expect(JSON.stringify(st)).not.toContain(w.undone);
  });

  test("a pair settled inside the week is not yet one of them, and a quiet week reads 0 of N", async () => {
    const w = await world();
    clock = noon("2026-10-11");
    const quiet = await cli(["mechanisms"]);
    expect(quiet.out).toContain("Settled things repeated: 0 of 3 pairs this week (re-raised 0; shown only 0)");
    clock = noon("2026-10-10");
    const early = await cli(["mechanisms"]);
    expect(early.out.find((l) => l.startsWith("Settled things repeated:"))).toBe("Settled things repeated: nothing was settled before this week, so nothing to read yet.");
    expect(w.build.length).toBeGreaterThan(0);
  });

  test("the harness reads the same function over the whole record, and compare shows it", async () => {
    const w = await world();
    await laterWeek(w);
    const all = settledOf(dir);
    expect(all).not.toBeNull();
    expect(all?.from).toBeNull();
    // The undone settle never was undone here, so three pairs stand; the undone loser's drewOn counts.
    expect(all?.pairs).toBe(3);
    expect(all?.repeats).toBe(3);
    const rows = readRecord("replay", { settled: all, days: [] }, null).rows;
    expect(rows["settled pairs"]).toBe(3);
    expect(rows["settled repeated"]).toBe(3);
    expect(rows["settled re-raised"]).toBe(all?.reraised ?? -1);
    expect(readRecord("replay", { days: [] }, null).rows["settled pairs"]).toBeUndefined();
  });

  test("a row from before the build stamp falls in its own bucket", () => {
    const r: SettledReading = {
      from: "2026-10-16",
      to: "2026-10-22",
      pairs: 231,
      repeats: 2,
      reraised: 0,
      shownOnly: 14,
      repeatVia: { drewOn: 1, quoted: 0, rated: 2, cited: 0 },
      reraisedVia: { loser: 0, winner: 0, restated: 0 },
      opened: 0,
      byBuild: [{ build: PRE_STAMP, repeats: 2, reraised: 0, shownOnly: 14 }],
      examples: { repeats: [], reraised: [], shownOnly: [] },
    };
    expect(settledLines(r)).toEqual([
      "Settled things repeated: 2 of 231 pairs this week (re-raised 0; shown only 14)",
      "  by build: pre-stamp 2 repeated, 0 re-raised, 14 shown only",
    ]);
    expect(typeof settledReading).toBe("function");
  });
});
