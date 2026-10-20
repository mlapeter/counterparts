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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runNight } from "../src/adapters/claude-code/night-run.js";
import { Counterpart } from "../src/core/counterpart.js";
import { learnIds, readChild, recordedSeat, replayNight, withIds } from "../tools/harness/night.js";

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
const use = (id: string, name: string, input: unknown): unknown => ({ type: "tool_use", id, name, input });
const result = (id: string, text: string): unknown => ({ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] });

function transcript(path: string, calls: { name: string; input: unknown; answer: unknown }[]): void {
  const lines: string[] = [line({ type: "user", timestamp: "2026-03-10T07:00:00.000Z", message: { role: "user", content: "THE LAUNCH PROMPT" } })];
  calls.forEach((c, i) => {
    const at = new Date(Date.parse("2026-03-10T07:00:00.000Z") + (i + 1) * 1_000).toISOString();
    lines.push(line({ type: "assistant", timestamp: at, message: { role: "assistant", content: [use(`t${String(i)}`, c.name, c.input)] } }));
    lines.push(line({ type: "user", timestamp: at, message: { role: "user", content: [result(`t${String(i)}`, typeof c.answer === "string" ? c.answer : JSON.stringify(c.answer))] } }));
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
  const c = Counterpart.open({ dir, owner: true, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
  const id = c.store.put({ type: "memory", kind: "fact", body: "The relief valve is seated before the pump runs.", salience: { novelty: null, relevance: 0.7, emotional: 0.2, predictive: 0.6 } });
  c.close();
  const path = join(root, "reflection.jsonl");
  transcript(path, [{ name: "mcp__counterparts__recall", input: { ids: [id] }, answer: { reason: "recorded" } }]);
  const empty = join(root, "dream.jsonl");
  transcript(empty, []);
  const open = (): Counterpart => Counterpart.open({ dir, owner: false, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" });
  const seat = recordedSeat({ dream: readChild(empty), reflection: readChild(path), open, setClock: (at) => (clock = Math.max(clock, at)), now: () => clock });
  const asks: string[] = [];
  const run = await runNight({
    open: () => Counterpart.open({ dir, owner: true, budgetBytes: 9_000, now: () => clock, timeZone: "UTC" }),
    config: { dataDir: dir, owner: true, injectionBudgetBytes: 9_000, timeZone: "UTC" },
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
  await expect(replayNight({ source: store, outcome: store, dreamTranscript: t, reflectionTranscript: t, env })).rejects.toThrow(/NO_DREAM/);
});
