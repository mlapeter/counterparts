/**
 * THE SEAT (2026-10-20, `core/seat.ts`): the night asks whoever sits in it,
 * and reads what the act did from the store. Held here: the acts' tools are
 * Claude Code's own lists, a night asks the seat in order (dream, then the
 * reflection), and a seat that refuses, throws or never starts ends the run
 * as a child that did the same always has. What Claude Code's seat sends a
 * `claude -p` is pinned byte for byte by `night-asks-golden.test.ts`.
 *
 * Hermetic: one temp store, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterConfig } from "../src/adapters/config.js";
import { CATCH_UP_TOOLS } from "../src/adapters/claude-code/night-catch-up.js";
import { DREAM_CHILD_DENIED, DREAM_CHILD_TOOLS, NIGHT_TOOLS, hostToolName, runNight } from "../src/adapters/claude-code/night-run.js";
import type { ClaudeCodeAnswer } from "../src/adapters/claude-code/night-run.js";
import { Counterpart, SEAT_TOOLS, seatAsk } from "../src/core/counterpart.js";
import type { Seat, SeatAsk } from "../src/core/counterpart.js";

let root: string;
let dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-seat-")));
  dir = join(root, "store");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, owner: true, injectionBudgetBytes: 9_000, ...over });

const clean = (over: Partial<ClaudeCodeAnswer> = {}): ClaudeCodeAnswer => ({
  refused: null,
  started: true,
  code: 0,
  timedOut: false,
  error: null,
  ms: 1,
  result: { code: 0, timedOut: false, error: null },
  neverStarted: false,
  spill: null,
  ...over,
});

/** A seat that records each ask and answers from a script. */
function scripted(asks: SeatAsk[], script: ((ask: SeatAsk) => ClaudeCodeAnswer)[] = []): Seat<ClaudeCodeAnswer> {
  return {
    name: "test",
    answer(ask) {
      asks.push(ask);
      const next = script[asks.length - 1];
      return Promise.resolve(next === undefined ? clean() : next(ask));
    },
  };
}

function night(seat: Seat<ClaudeCodeAnswer>, kind: Parameters<typeof runNight>[0]["kind"] = { kind: "night" }): ReturnType<typeof runNight> {
  return runNight({
    open: () => Counterpart.open({ dir, owner: true, budgetBytes: 9_000 }),
    config: config(),
    run: "nrn_seat",
    session: "ses-launch",
    scope: root,
    kind,
    seat,
  });
}

test("each act's tools are Claude Code's own lists, by the memory's names", () => {
  expect(SEAT_TOOLS["catch-up"].tools.map(hostToolName)).toEqual([...CATCH_UP_TOOLS]);
  expect(SEAT_TOOLS.dream.tools.map(hostToolName)).toEqual([...DREAM_CHILD_TOOLS]);
  expect(SEAT_TOOLS.dream.withhold.map(hostToolName)).toEqual([...DREAM_CHILD_DENIED]);
  expect(SEAT_TOOLS.reflection.tools.map(hostToolName)).toEqual([...NIGHT_TOOLS]);
  expect(SEAT_TOOLS.reflection.withhold).toEqual([]);
  const ask = seatAsk("dream", { prompt: "p", run: "r", session: "s", scope: "/x" });
  expect(ask).toEqual({ act: "dream", tools: SEAT_TOOLS.dream.tools, withhold: SEAT_TOOLS.dream.withhold, prompt: "p", run: "r", session: "s", scope: "/x" });
});

test("a night asks the seat for the dream, then the reflection, under the launching session", async () => {
  const asks: SeatAsk[] = [];
  const out = await night(scripted(asks));
  expect(asks.map((a) => a.act)).toEqual(["dream", "reflection"]);
  for (const a of asks) {
    expect(a.run).toBe("nrn_seat");
    expect(a.session).toBe("ses-launch");
    expect(a.scope).toBe(root);
    expect(a.prompt.length).toBeGreaterThan(0);
    expect(a.limits).toBeUndefined();
  }
  expect(out.children?.map((c) => c.child)).toEqual(["dream", "reflection"]);
});

test("a seat that refuses ends the run before anything starts, with its reason", async () => {
  const asks: SeatAsk[] = [];
  const out = await night(scripted(asks, [() => clean({ refused: "NO_COMMAND", started: false, code: null, neverStarted: true })]));
  expect(out.state).toBe("could-not-start");
  expect(out.reason).toBe("refused");
  expect(out.detail).toBe("NO_COMMAND");
  expect(out.children).toBeUndefined();
  expect(asks.length).toBe(1);
});

test("a seat that throws on the first ask is a spawn that failed; on the second, a reflection skipped", async () => {
  const boom = (): ClaudeCodeAnswer => {
    throw new TypeError("seat fell over");
  };
  const first = await night(scripted([], [boom]));
  expect(first.state).toBe("could-not-start");
  expect(first.reason).toBe("spawn-failed");
  expect(first.detail).toBe("TypeError");

  const second = await night(scripted([], [() => clean(), boom]));
  expect(second.children).toEqual([
    { child: "dream", code: 0, ms: 1 },
    { child: "reflection", code: null, ms: 0, skipped: "spawn-failed" },
  ]);
});

test("a reflection the seat never started is said as not started; no claude is said as such", async () => {
  const never = (spawnCode: string) => (): ClaudeCodeAnswer =>
    clean({ started: false, code: null, neverStarted: true, error: `spawn ${spawnCode}`, result: { code: null, timedOut: false, error: `spawn ${spawnCode}`, spawnCode } });
  const out = await night(scripted([], [() => clean(), never("ENOENT")]));
  expect(out.children?.[1]).toEqual({ child: "reflection", code: null, ms: 0, skipped: "no-claude" });
  const first = await night(scripted([], [never("ENOENT")]));
  expect(first.state).toBe("could-not-start");
  expect(first.reason).toBe("no-claude");
});

test("the reflection alone is one ask", async () => {
  const asks: SeatAsk[] = [];
  await night(scripted(asks), { kind: "reflection", dream: "drm_0123456789ab" });
  expect(asks.map((a) => a.act)).toEqual(["reflection"]);
  expect(asks[0]!.tools).toEqual(SEAT_TOOLS.reflection.tools);
});
