/**
 * The recorded night (`tools/harness/night.ts`): a night's transcript read
 * back into calls, ids the replay mints mapped onto the recorded ones, and the
 * recorded seat driving the real `runNight` through the memory's own server.
 * The output-level replay of a real night runs by hand against a kept-aside
 * copy (`tools/harness/README.md`); nothing here reads one.
 *
 * Hermetic: a temp store and synthetic transcripts, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copyFileSync } from "node:fs";

import { Database } from "bun:sqlite";

import { runNight } from "../src/adapters/claude-code/night-run.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { runningBuild } from "../src/core/store/operational.js";
import { learnIds, nightRowFor, readChild, recordedSeat, replayNight, withIds } from "../tools/harness/night.js";

let root: string;
let dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-harness-night-")));
  dir = join(root, "store");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const line = (o: unknown): string => JSON.stringify(o);

/** A single-file copy of a closed store, as a snapshot is: out of WAL. */
function snapshotOf(from: string, to: string): void {
  copyFileSync(from, to);
  const db = new Database(to);
  db.run("PRAGMA journal_mode = DELETE");
  db.close();
}
const use = (id: string, name: string, input: unknown): unknown => ({ type: "tool_use", id, name, input });
const result = (id: string, text: string): unknown => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] });

/** A transcript as the host writes one; `sessionId` on every line when given, as Claude Code writes it. */
function transcript(path: string, calls: { name: string; input: unknown; answer: unknown }[], sessionId?: string): void {
  const s = sessionId === undefined ? {} : { sessionId };
  const lines: string[] = [line({ type: "user", ...s, timestamp: "2026-03-10T07:00:00.000Z", message: { role: "user", content: "THE LAUNCH PROMPT" } })];
  calls.forEach((c, i) => {
    const at = new Date(Date.parse("2026-03-10T07:00:00.000Z") + (i + 1) * 1_000).toISOString();
    lines.push(line({ type: "assistant", ...s, timestamp: at, message: { role: "assistant", content: [use(`t${String(i)}`, c.name, c.input)] } }));
    lines.push(line({ type: "user", ...s, timestamp: at, message: { role: "user", content: [result(`t${String(i)}`, typeof c.answer === "string" ? c.answer : JSON.stringify(c.answer))] } }));
  });
  writeFileSync(path, lines.join("\n") + "\n");
}

test("a child's transcript reads back as its prompt and its calls to the memory's tools, the host's own left out", () => {
  const path = join(root, "child.jsonl");
  transcript(path, [
    { name: "ToolSearch", input: { query: "x" }, answer: "found" },
    { name: "mcp__counterparts__dream", input: { phase: "begin", session: "s" }, answer: { phase: "begin", dream: "drm_aaaaaaaaaaaa" } },
    { name: "mcp__counterparts__recall", input: { ids: ["mem_bbbbbbbbbbbb"] }, answer: "not json" },
  ]);
  const child = readChild(path);
  expect(child.prompt).toBe("THE LAUNCH PROMPT");
  expect(child.calls.map((c) => c.tool)).toEqual(["dream", "recall"]);
  expect(child.calls[0]!.result).toEqual({ phase: "begin", dream: "drm_aaaaaaaaaaaa" });
  expect(child.calls[1]!.result).toBe("not json");
  expect(child.calls[0]!.at).toBe(Date.parse("2026-03-10T07:00:02.000Z"));
  expect(child.startedAt).toBe(Date.parse("2026-03-10T07:00:00.000Z"));
});

test("only message lines are read, each call at its first sighting; a call the host refused is marked and never replayed", () => {
  const path = join(root, "child.jsonl");
  const at = "2026-03-10T07:00:01.000Z";
  writeFileSync(
    path,
    [
      line({ type: "user", timestamp: "2026-03-10T07:00:00.000Z", message: { role: "user", content: "P" } }),
      line({ type: "assistant", timestamp: at, message: { role: "assistant", content: [use("a", "mcp__counterparts__recall", { ids: ["mem_111111111111"] }), use("b", "mcp__counterparts__reflect", { phase: "begin" })] } }),
      line({ type: "user", timestamp: at, message: { role: "user", content: [result("b", "denied"), result("a", '{"reason":"expanded"}')] } }),
      // The API request's blob repeats both blocks later, with no time and a cut result.
      line({ type: "api-request-blob", message: { content: [use("a", "mcp__counterparts__recall", { ids: ["mem_999999999999"] }), result("a", "<persisted-output>cut</persisted-output>")] } }),
    ].join("\n"),
  );
  const lines = readFileSync(path, "utf8").split("\n");
  lines[2] = line({
    type: "user",
    timestamp: at,
    message: { role: "user", content: [{ ...(result("b", "denied") as object), is_error: true }, { ...(result("a", '{"reason":"expanded"}') as object), is_error: true }] },
  });
  writeFileSync(path, lines.join("\n"));
  const child = readChild(path);
  expect(child.calls.map((c) => [c.tool, c.at, c.result, c.hostRefused ?? false])).toEqual([
    // The server's own refusal (JSON) is replayed; the host's prose refusal is not.
    ["recall", Date.parse(at), { reason: "expanded" }, false],
    ["reflect", Date.parse(at), "denied", true],
  ]);
  expect(child.calls[0]!.input).toEqual({ ids: ["mem_111111111111"] });
});

test("ids that existed before the night are never paired: two memories swapped in a list stay themselves", () => {
  const existed = new Set(["mem_aaaaaaaaaaaa", "mem_bbbbbbbbbbbb"]);
  const map = new Map<string, string>();
  learnIds({ shown: ["mem_aaaaaaaaaaaa", "mem_bbbbbbbbbbbb"], dream: "drm_111111111111" }, { shown: ["mem_bbbbbbbbbbbb", "mem_aaaaaaaaaaaa"], dream: "drm_222222222222" }, map, existed);
  expect([...map]).toEqual([["drm_111111111111", "drm_222222222222"]]);
  // Two recorded ids never land on one replayed id.
  learnIds(["mem_333333333333", "mem_444444444444"], ["mem_555555555555", "mem_555555555555"], map, existed);
  expect(map.get("mem_333333333333")).toBe("mem_555555555555");
  expect(map.has("mem_444444444444")).toBe(false);
});

test("ids the replay minted are learned beside the recorded answer, and put into later calls wherever they appear", () => {
  const map = new Map<string, string>();
  learnIds(
    { dream: "drm_aaaaaaaaaaaa", parts: [{ id: "mem_111111111111" }], same: "mem_222222222222" },
    { dream: "drm_bbbbbbbbbbbb", parts: [{ id: "mem_333333333333" }], same: "mem_222222222222" },
    map,
  );
  expect([...map]).toEqual([
    ["drm_aaaaaaaaaaaa", "drm_bbbbbbbbbbbb"],
    ["mem_111111111111", "mem_333333333333"],
  ]);
  expect(withIds({ dream: "drm_aaaaaaaaaaaa", text: "see mem_111111111111 and mem_222222222222", n: 3 }, map)).toEqual({
    dream: "drm_bbbbbbbbbbbb",
    text: "see mem_333333333333 and mem_222222222222",
    n: 3,
  });
});

test("the recorded seat drives the real night through the memory's own server; a write-up owed is refused, not recorded", async () => {
  let clock = Date.parse("2026-03-10T07:00:00.000Z");
  const c = Counterpart.open({ dir, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
  const id = c.store.put({ type: "memory", kind: "fact", body: "The relief valve is seated before the pump runs.", salience: { novelty: null, relevance: 0.7, emotional: 0.2, predictive: 0.6 } });
  c.close();
  const path = join(root, "reflection.jsonl");
  transcript(path, [{ name: "mcp__counterparts__recall", input: { ids: [id] }, answer: { reason: "recorded" } }]);
  const empty = join(root, "dream.jsonl");
  transcript(empty, []);
  const open = (): Counterpart => Counterpart.open({ dir, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
  const seat = recordedSeat({ dream: readChild(empty), reflection: readChild(path), open, setClock: (at) => (clock = Math.max(clock, at)), now: () => clock });
  const asks: string[] = [];
  const run = await runNight({
    open: () => Counterpart.open({ dir, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" }),
    config: { dataDir: dir, injectionBudgetBytes: 9_000, timeZone: "UTC" },
    run: "nrn_test",
    session: "ses-x",
    scope: root,
    kind: { kind: "reflection", dream: "drm_0123456789ab" },
    seat: {
      name: seat.name,
      answer: (ask) => {
        asks.push(ask.act);
        return seat.answer(ask);
      },
    },
    now: () => clock,
  });
  expect(asks).toEqual(["reflection"]);
  expect(seat.tallies["reflection"]?.calls).toBe(1);
  expect(seat.tallies["reflection"]?.refused).toBe(0);
  expect(run.children?.[0]?.child).toBe("reflection");
  expect(await seat.answer({ act: "catch-up", prompt: "p", tools: ["session_end"], withhold: [], run: "r", session: "s", scope: root })).toMatchObject({ refused: "not-recorded", started: false });
});

test("a scripted night, recorded and replayed on a copy of the store before it, comes out the same", async () => {
  let clock = Date.parse("2026-03-10T07:00:00.000Z");
  const open = (owner: boolean): Counterpart => Counterpart.open({ dir, now: () => clock, timeZone: "UTC" });
  const c = open(true);
  for (const body of ["The relief valve is seated before the pump runs.", "Loop two loses pressure when the valve is late.", "Mike prefers the valve checked twice."]) {
    c.store.put({ type: "memory", kind: "fact", body, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
  }
  c.close();
  const source = join(root, "pre-night.sqlite");
  snapshotOf(join(dir, "counterparts.sqlite"), source);

  // THE REAL NIGHT, scripted: the dream begun and journaled through the server, every call kept.
  const session = "ses-night";
  const calls: { name: string; input: Record<string, unknown>; answer: unknown }[] = [];
  const live = open(false);
  const server = new McpServer({ counterpart: live, session, scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "nrn_real" }, now: () => clock });
  const call = async (tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    clock += 1_000;
    const out = (await server.call(tool, input)).structuredContent;
    calls.push({ name: `mcp__counterparts__${tool}`, input, answer: out });
    return out;
  };
  const begun = await call("dream", { phase: "begin", session });
  const dreamId = begun["dream"] as string;
  expect(typeof dreamId).toBe("string");
  const journaled = await call("dream", { phase: "journal", dream: dreamId, session, title: "Valves and loops", text: `Dreamt of ${dreamId} and the valves.` });
  expect(journaled["phase"]).toBe("journal");
  live.close();
  const outcome = join(root, "after.sqlite");
  snapshotOf(join(dir, "counterparts.sqlite"), outcome);
  const dreamT = join(root, "dream.jsonl");
  transcript(dreamT, calls);
  const reflectionT = join(root, "reflection.jsonl");
  transcript(reflectionT, []);

  const work = join(root, "work");
  const r = await replayNight({ source, outcome, dreamTranscript: dreamT, reflectionTranscript: reflectionT, workRoot: work, timeZone: "UTC", embed: false, env: { HOME: join(root, "home") } });
  expect(r.night.parts).toContain("dream");
  expect(r.build).toBe(runningBuild());
  expect(r.calls["dream"]).toMatchObject({ calls: 2, skipped: 0, refused: 0 });
  expect(r.idsMapped).toBeGreaterThanOrEqual(1);
  expect(r.dream?.state.same).toBe(true);
  expect(r.dream?.titleSame).toBe(true);
  expect(r.dream?.changes.same).toBe(true);
  // Nothing of the store's words in the record; the work dir is gone.
  const text = JSON.stringify(r);
  for (const words of ["relief valve", "Valves and loops", "Dreamt of"]) expect(text).not.toContain(words);
  expect(readdirSync(work)).toEqual([]);
});

test("2026-10-22, lane L: the night's reflection is found by the children's session ids on its row, and by time when the row names none", async () => {
  let clock = Date.parse("2026-03-10T07:00:00.000Z");
  const open = (): Counterpart => Counterpart.open({ dir, now: () => clock, timeZone: "UTC" });
  const c = open();
  for (const body of ["The relief valve is seated before the pump runs.", "Loop two loses pressure when the valve is late."]) {
    c.store.put({ type: "memory", kind: "fact", body, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
  }
  c.close();
  const source = join(root, "pre-night.sqlite");
  snapshotOf(join(dir, "counterparts.sqlite"), source);

  const session = "ses-night";
  const calls: { name: string; input: Record<string, unknown>; answer: unknown }[] = [];
  const live = open();
  const server = new McpServer({ counterpart: live, session, scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream", COUNTERPARTS_NIGHT_RUN: "nrn_real" }, now: () => clock });
  const call = async (tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    clock += 1_000;
    const out = (await server.call(tool, input)).structuredContent;
    calls.push({ name: `mcp__counterparts__${tool}`, input, answer: out });
    return out;
  };
  const dreamId = (await call("dream", { phase: "begin", session }))["dream"] as string;
  await call("dream", { phase: "journal", dream: dreamId, session, title: "Valves and loops", text: `Dreamt of ${dreamId}.` });
  // THE REFLECTION, three hours on: outside the transcripts' time window, so only its row's names find it.
  clock += 3 * 3_600_000;
  const r = live.reflections.begin({ session, dream: dreamId });
  if (!r.ok) throw new Error(r.reason);
  live.reflections.finish({ reflection: r.bundle.reflection, session, entry: "Nothing much tonight." });
  const DREAM_CHILD = "11111111-1111-4111-8111-111111111111";
  const REFLECTION_CHILD = "22222222-2222-4222-8222-222222222222";
  const row = { run: "nrn_real", date: "2026-03-10", kind: "night" as const, session, startedAt: Date.parse("2026-03-10T07:00:00.000Z"), reason: null, detail: null, code: 0 };
  live.dreams.recordNightRun({ ...row, state: "started", endedAt: null, dream: null, reflection: null, children: [{ child: "dream", code: null, ms: 0, hostSession: DREAM_CHILD }] });
  live.dreams.recordNightRun({
    ...row,
    state: "done",
    endedAt: clock,
    dream: dreamId,
    reflection: r.bundle.reflection,
    children: [
      { child: "dream", code: 0, ms: 1, hostSession: DREAM_CHILD },
      { child: "reflection", code: 0, ms: 1, hostSession: REFLECTION_CHILD },
    ],
  });
  live.close();
  const outcome = join(root, "after.sqlite");
  snapshotOf(join(dir, "counterparts.sqlite"), outcome);

  const replay = async (sessions: [string | undefined, string | undefined]) => {
    const dreamT = join(root, "dream.jsonl");
    transcript(dreamT, calls, sessions[0]);
    const reflectionT = join(root, "reflection.jsonl");
    transcript(reflectionT, [], sessions[1]);
    return replayNight({ source, outcome, dreamTranscript: dreamT, reflectionTranscript: reflectionT, workRoot: join(root, "work"), timeZone: "UTC", embed: false, env: { HOME: join(root, "home") } });
  };

  // The reflection child's id alone is enough; and so is the dream child's.
  const byReflection = await replay([undefined, REFLECTION_CHILD]);
  expect(byReflection.matchedBy).toBe("session");
  expect(byReflection.reflection?.state.recorded).toBe("reflected");
  const byDream = await replay([DREAM_CHILD, undefined]);
  expect(byDream.matchedBy).toBe("session");
  expect(byDream.reflection?.state.recorded).toBe("reflected");
  // No ids in the transcripts, or ids no row names: by time, which misses a reflection three hours on.
  for (const ids of [[undefined, undefined], ["33333333-3333-4333-8333-333333333333", undefined]] as [string | undefined, string | undefined][]) {
    const byTime = await replay(ids);
    expect(byTime.matchedBy).toBe("time");
    expect(byTime.reflection).toBeNull();
  }
  // The row read straight: the `started` row (no outcome yet) is passed over for the run's later one.
  const db = new Database(outcome, { readonly: true });
  try {
    expect(nightRowFor(db, [DREAM_CHILD])).toEqual({ run: "nrn_real", dream: dreamId, reflection: r.bundle.reflection });
    expect(nightRowFor(db, [null])).toBeNull();
  } finally {
    db.close();
  }
});

test("a transcript's own session id is read off its lines; none, null", () => {
  const withId = join(root, "with.jsonl");
  transcript(withId, [], "44444444-4444-4444-8444-444444444444");
  expect(readChild(withId).session).toBe("44444444-4444-4444-8444-444444444444");
  const without = join(root, "without.jsonl");
  transcript(without, []);
  expect(readChild(without).session).toBeNull();
});

test("a replay refuses a live source, a preset data dir, and a dream transcript that never began a dream", async () => {
  const fake = join(root, "home", ".counterparts", "x.sqlite");
  mkdirSync(join(root, "home", ".counterparts"), { recursive: true });
  writeFileSync(fake, "");
  const env = { HOME: join(root, "home") };
  const t = join(root, "t.jsonl");
  transcript(t, []);
  await expect(replayNight({ source: fake, outcome: fake, dreamTranscript: t, reflectionTranscript: t, env })).rejects.toThrow(/SOURCE_IS_LIVE/);
  await expect(replayNight({ source: fake, outcome: fake, dreamTranscript: t, reflectionTranscript: t, env: { ...env, COUNTERPARTS_DATA_DIR: root } })).rejects.toThrow(/DATA_DIR_PRESET/);
  const store = join(root, "copy.sqlite");
  writeFileSync(store, "");
  const wal = join(root, "wal.sqlite");
  const w = new Database(wal);
  w.run("PRAGMA journal_mode = WAL");
  w.run("CREATE TABLE t (x)");
  w.close();
  await expect(replayNight({ source: wal, outcome: wal, dreamTranscript: t, reflectionTranscript: t, env })).rejects.toThrow(/SOURCE_IN_WAL/);
  await expect(replayNight({ source: store, outcome: store, dreamTranscript: t, reflectionTranscript: t, env })).rejects.toThrow(/NO_DREAM/);
});
