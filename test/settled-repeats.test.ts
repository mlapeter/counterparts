/**
 * SETTLED THINGS REPEATED (2026-10-22, lane R) — `counterparts mechanisms`'
 * line and its `--json`, read through the CLI door on a store built through
 * the real ones: pairs settled by `remember` with `updates`, an undo by
 * `counterparts settle --undo`, a later `drewOn` on `session_end` naming the
 * losing side (credited when it was shown, refused when it was archived — the
 * session said it drew on it either way), a later `updates … how: open` that
 * names a loser again, a new memory that says a corrected thing again, and
 * `session_end`'s `rated` (3 a repeat, 1 shown only). The one row written in
 * shape rather than through its door is a `recall.decision` footnote: a fresh
 * store's recall finds no candidates until the boundary worker indexes it.
 * The harness column reads the same function over the whole record.
 *
 * Hermetic: a fresh temp dir per test, removed after it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { PRE_STAMP, settledLines, settledReading } from "../src/adapters/cli/mechanisms.js";
import type { SettledReading } from "../src/adapters/cli/mechanisms.js";
import { Counterpart } from "../src/core/counterpart.js";
import { freshGateState, loadGateState, saveGateState } from "../src/core/recall/index.js";
import type { GateState } from "../src/core/recall/index.js";
import { Store, runningBuild } from "../src/core/store/index.js";
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
  // The console reads the store's zone from the host configuration beside it. The stores here are
  // written in UTC (`brain()`), so the console is told UTC too, whatever the machine's TZ.
  writeFileSync(join(root, "claude-code.json"), JSON.stringify({ timeZone: "UTC" }));
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

const HEADLINE = "Settled things drawn on again:";

describe("settled things drawn on again — the ratings and recall's own showing", () => {
  test("a loser rated 3 is drawn on (and alone: its winner was not rated with it), one rated 1 is shown only, one recall footnoted is shown only", async () => {
    const c = brain();
    let rated: string;
    let low: string;
    let footnoted: string;
    try {
      const s = server(c);
      for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) day(c, d);
      rated = idOf(await remember(s, { text: "The team lunch is at the Thai place on Thursdays." }));
      low = idOf(await remember(s, { text: "The printer on the second floor needs a code to print." }));
      footnoted = idOf(await remember(s, { text: "Quarterly planning for the harbour ferry timetable happens in the Lisbon office." }));
      day(c, "2026-10-04");
      await remember(s, { text: "The team lunch moved from the Thai place to the noodle bar, still on Thursdays.", updates: rated, how: "changed" });
      await remember(s, { text: "The printer on the second floor prints without a code now.", updates: low, how: "changed" });
      await remember(s, { text: "Quarterly planning for the harbour ferry timetable moved from Lisbon to the Porto office.", updates: footnoted, how: "changed" });
      for (const d of ["2026-10-08", "2026-10-12"]) day(c, d);
      shown(c, 1, [rated, low]);
      const end = (await s.call("session_end", { session: SESSION, memories: [], rated: [{ id: rated, score: 3 }, { id: low, score: 1 }] })).structuredContent;
      expect((end["rated"] as Record<string, unknown>)["rated"]).toBe(2);
      // Recall's own showing: a `recall.decision` row footnoting the old ferry planning memory, in the
      // shape `Counterpart#recallForTurn` writes it (its loud lines and footnotes as `{ id, … }`). Written
      // here rather than through a turn: a fresh store's candidates come from the text index the boundary
      // worker builds, so a turn on this store finds none.
      c.store.appendEvent({ name: "recall.decision", day: c.store.livedDay(), payload: { session: "sess_other", turn: 1, date: "2026-10-12", reason: "shown", surfaced: [], footnotes: [{ id: footnoted, sal: 0.5 }] } });
    } finally {
      c.close();
    }
    const { out } = await cli(["mechanisms", "--json"]);
    const st = (JSON.parse(out.join("\n")) as { settled: SettledReading }).settled;
    expect(st.pairs).toBe(3);
    expect(st.repeats).toBe(1);
    expect(st.repeatVia.rated).toBe(1);
    expect(st.examples.repeats.map((e) => e.over)).toEqual([rated]);
    expect(st.shownOnly).toBe(2);
    expect(st.examples.shownOnly.map((e) => e.over).sort()).toEqual([low, footnoted].sort());
    expect(st.byHow.changed).toEqual({ pairs: 3, repeats: 1, reraised: 0, viaWinner: 0, shownOnly: 2, alone: 1 });
    expect(st.byHow.corrected).toEqual({ pairs: 0, repeats: 0, reraised: 0, viaWinner: 0, shownOnly: 0 });
    expect(st.byBuild).toEqual([
      {
        build: runningBuild(),
        repeats: 1,
        reraised: 0,
        viaWinner: 0,
        shownOnly: 2,
        byHow: { changed: { repeats: 1, reraised: 0, viaWinner: 0, shownOnly: 2 }, corrected: { repeats: 0, reraised: 0, viaWinner: 0, shownOnly: 0 } },
        turns: 1,
        days: 1,
      },
    ]);
  });
});

describe("settled things drawn on again — `counterparts mechanisms`", () => {
  test("the line counts a drawn-on loser, a re-raise and a restatement, split by kind, and leaves an undone settle out", async () => {
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
    expect(out.find((l) => l.startsWith(HEADLINE))).toBe(
      "Settled things drawn on again: 2 of 2 pairs this week (changed 1 of 1, corrected 1 of 1 — a corrected one is archived, so only a drewOn, a cite or a restatement can reach it); came up again 2; shown only 0",
    );
    expect(out).toContain("  beside it: the winner in a newer pair 0; changed ones drawn on without their winner in the same row 1");
    expect(out.find((l) => l.startsWith("  by build"))).toBe(
      `  by build (drawn on / came up again / shown only): ${runningBuild()} changed 1/1/0, corrected 1/1/0 (0 turns on 0 lived days)`,
    );

    const j = await cli(["mechanisms", "--json"]);
    expect(j.code).toBe(0);
    const doc = JSON.parse(j.out.join("\n")) as { settled: SettledReading; mechanisms: unknown[] };
    expect(doc.mechanisms.length).toBeGreaterThan(0);
    const st = doc.settled;
    expect(st.from).toBe("2026-10-06");
    expect(st.to).toBe("2026-10-12");
    expect(st.pairs).toBe(2);
    expect(st.repeatVia).toEqual({ drewOn: 2, quoted: 0, rated: 0, cited: 0 });
    expect(st.reraisedVia).toEqual({ loser: 1, restated: 1, winner: 0 });
    expect(st.examples.repeats.map((e) => e.pair).sort()).toEqual([w.build, w.deploy].sort());
    expect(st.examples.reraised.map((e) => e.pair).sort()).toEqual([w.build, w.deploy].sort());
    // Ids only: no example carries a body.
    expect(JSON.stringify(st)).not.toContain("minutes");
    // The undone pair is nowhere.
    expect(JSON.stringify(st)).not.toContain(w.undone);
  });

  test("saying the WINNER again is the settle holding: it does not come up again", async () => {
    const c = brain();
    try {
      const s = server(c);
      for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) day(c, d);
      const old = idOf(await remember(s, { text: "The weekly sync with the design team is on Monday." }));
      day(c, "2026-10-04");
      await remember(s, { text: "The weekly sync with the design team is on Tuesday.", updates: old, how: "changed" });
      for (const d of ["2026-10-08", "2026-10-12"]) day(c, d);
      await remember(s, { text: "Reminder: the weekly sync with the design team is on Tuesday." });
    } finally {
      c.close();
    }
    const { out } = await cli(["mechanisms", "--json"]);
    const st = (JSON.parse(out.join("\n")) as { settled: SettledReading }).settled;
    expect(st.pairs).toBe(1);
    expect(st.reraised).toBe(0);
    expect(st.reraisedVia.restated).toBe(0);
  });

  test("a flip-back through the owner's door undoes the old settle, so the old pair is gone", async () => {
    const c = brain();
    let old: string;
    let neu: string;
    let first: string;
    try {
      const s = server(c);
      for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) day(c, d);
      old = idOf(await remember(s, { text: "The release train leaves every second Wednesday." }));
      day(c, "2026-10-04");
      neu = idOf(await remember(s, { text: "The release train now leaves every Thursday, weekly.", updates: old, how: "changed" }));
      first = pairOver(c, old);
      day(c, "2026-10-05");
    } finally {
      c.close();
    }
    clock = noon("2026-10-05");
    const flip = await cli(["settle", "--holds", old, "--against", neu, "--how", "changed", "--why", "it went back"]);
    expect(flip.code).toBe(0);
    clock = noon("2026-10-12");
    const { out } = await cli(["mechanisms", "--json"]);
    const st = (JSON.parse(out.join("\n")) as { settled: SettledReading }).settled;
    expect(JSON.stringify(st)).not.toContain(first);
  });

  test("a flip-back kept as a second pair ends the first from that moment", () => {
    clock = noon("2026-10-01");
    const store = Store.open({ dir, now: () => clock, timeZone: "UTC" });
    try {
      for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
        clock = noon(d);
        store.advanceClock(d);
      }
      const put = (body: string): string =>
        store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.6, emotional: 0.2, predictive: 0.6 }, physics: { birthDay: store.livedDay(), lastUsedDay: store.livedDay() } });
      const a = put("The release train leaves every second Wednesday.");
      const b = put("The release train now leaves every Thursday, weekly.");
      clock = noon("2026-10-04");
      store.advanceClock("2026-10-04");
      store.settleContradiction({ newId: "ctr_first0000001", x: a, y: b, how: "changed", holds: b, over: a, actor: "session", actorId: null, why: null, day: store.livedDay() });
      clock = noon("2026-10-05");
      store.advanceClock("2026-10-05");
      store.settleContradiction({ newId: "ctr_second000001", x: b, y: a, how: "changed", holds: a, over: b, actor: "dream", actorId: null, why: null, day: store.livedDay() });
      const week = settledReading(store, "2026-10-12");
      expect(week.flippedBack).toBe(1);
      expect(week.pairs).toBe(1);
      // Read over the whole record, both stand: the first until the flip.
      expect(settledReading(store, "2026-10-12", "all").pairs).toBe(2);
    } finally {
      store.close();
    }
  });

  test("a pair settled inside the week is not yet one of them, and a quiet week reads 0 of N", async () => {
    const w = await world();
    clock = noon("2026-10-11");
    const quiet = await cli(["mechanisms"]);
    expect(quiet.out.find((l) => l.startsWith(HEADLINE))).toBe(
      "Settled things drawn on again: 0 of 3 pairs this week (changed 0 of 2, corrected 0 of 1 — a corrected one is archived, so only a drewOn, a cite or a restatement can reach it); came up again 0; shown only 0",
    );
    clock = noon("2026-10-10");
    const early = await cli(["mechanisms"]);
    expect(early.out.find((l) => l.startsWith(HEADLINE))).toBe("Settled things drawn on again: nothing was settled before this week, so nothing to read yet.");
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
    expect(rows["settled drawn on again"]).toBe(3);
    expect(rows["settled came up again"]).toBe(all?.reraised ?? -1);
    expect(rows["settled: the winner in a newer pair"]).toBe(all?.viaWinner ?? -1);
    expect(readRecord("replay", { days: [] }, null).rows["settled pairs"]).toBeUndefined();
  });

  test("the line and the split by build, from a reading", () => {
    const zero = { repeats: 0, reraised: 0, viaWinner: 0, shownOnly: 0 };
    const r: SettledReading = {
      from: "2026-10-16",
      to: "2026-10-22",
      pairs: 231,
      repeats: 2,
      reraised: 0,
      viaWinner: 3,
      shownOnly: 14,
      byHow: { changed: { pairs: 210, repeats: 2, reraised: 0, viaWinner: 3, shownOnly: 14, alone: 1 }, corrected: { pairs: 21, ...zero } },
      repeatVia: { drewOn: 1, quoted: 0, rated: 2, cited: 0 },
      reraisedVia: { loser: 0, restated: 0, winner: 3 },
      opened: 0,
      flippedBack: 0,
      byBuild: [
        { build: PRE_STAMP, repeats: 2, reraised: 0, viaWinner: 3, shownOnly: 14, byHow: { changed: { repeats: 2, reraised: 0, viaWinner: 3, shownOnly: 14 }, corrected: zero }, turns: 900, days: 6 },
        { build: "0.3.32", ...zero, byHow: { changed: zero, corrected: zero }, turns: 1, days: 1 },
      ],
      examples: { repeats: [], reraised: [], viaWinner: [], shownOnly: [] },
    };
    expect(settledLines(r)).toEqual([
      "Settled things drawn on again: 2 of 231 pairs this week (changed 2 of 210, corrected 0 of 21 — a corrected one is archived, so only a drewOn, a cite or a restatement can reach it); came up again 0; shown only 14",
      "  beside it: the winner in a newer pair 3; changed ones drawn on without their winner in the same row 1",
      "  by build (drawn on / came up again / shown only): pre-stamp changed 2/0/14, corrected 0/0/0 (900 turns on 6 lived days); 0.3.32 changed 0/0/0, corrected 0/0/0 (1 turn on 1 lived day)",
    ]);
    expect(typeof settledReading).toBe("function");
  });
});
