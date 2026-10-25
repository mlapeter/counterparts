/**
 * THE MEANING LOOKUP READS THIS TURN (2026-10-25, `recall.SEMANTIC_THIS_TURN`,
 * on). Driven through the door: the UserPromptSubmit hook on an adapter over a
 * temp store, the detached worker's `laggedSemantic` between turns as the Stop
 * would run it, and the MCP `recall` tool for the deliberate ask. Read back
 * from the durable rows the hook leaves (`adapter.recall`'s `semantic` /
 * `semanticFrom`, `recall.decision`'s verdicts), not from the helper.
 *
 *   1. a session's 2nd turn with a fresh lag row ranks its OWN prompt's
 *      meaning when on, the lag's when off;
 *   2. past the in-line count guard the fresh lag row is used, recorded
 *      `lagged`; with no fresh row there, `in-line-skipped`;
 *   3. the first prompt is unchanged either way;
 *   4. deliberate recall is unchanged either way.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter, LiveEmbedder } from "../src/adapters/claude-code/index.js";
import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { backfillVectors, laggedSemantic } from "../src/adapters/claude-code/vectors.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import type { Counterpart } from "../src/core/counterpart.js";
import { RECALL_DELIVERED_EVENT } from "../src/core/counterpart-events.js";
import { TUNABLES as RECALL } from "../src/core/recall/index.js";
import { parseSetting } from "../tools/harness/settings.js";
import { findable } from "./store-fixture.js";

const SCOPE = "/work/this-turn";
const ZONE = "UTC";

let dir = "";
const open: Counterpart[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cp-this-turn-"));
});

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Three topics, one axis each; the sync face computes any text, as the live table does. */
function topic(t: string): number[] {
  const l = t.toLowerCase();
  if (l.includes("otter")) return [1, 0, 0];
  if (l.includes("kite")) return [0, 1, 0];
  return [0, 0, 1];
}

function embedder(): LiveEmbedder {
  return {
    model: "test-embed-1",
    embed: topic,
    vector: async (t: string) => topic(t),
    warm: async (texts: readonly string[]) => texts.length,
    stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

/** A prompt the embedder sends to the otter memory, sharing no content word with
 *  it ("hotter" holds "otter"; the memory says neither "warmer" nor "water"). */
const MEANING_ONLY = "Hotter or warmer near the water, remind me?";

interface World {
  a: ClaudeCodeAdapter;
  emb: LiveEmbedder;
  otter: string;
  kite: string;
  /** What the hook's own `recallForTurn` call returned, turn by turn (a spy that calls through). */
  turns: { mock: { results: { value: unknown }[] } };
}

async function world(switchOn: boolean, tunables: Record<string, number> = {}): Promise<World> {
  const emb = embedder();
  const a = openAdapter(
    { dataDir: join(dir, switchOn ? "on" : "off"), injectionBudgetBytes: 9_000, timeZone: ZONE },
    { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }), embedder: emb },
  );
  open.push(a.counterpart);
  const turns = spyOn(a.counterpart, "recallForTurn");
  const t = a.counterpart.recall.tunables as unknown as Record<string, unknown>;
  t["SEMANTIC_THIS_TURN"] = switchOn;
  for (const [k, v] of Object.entries(tunables)) t[k] = v;
  const store = a.counterpart.store;
  findable(store);
  const otter = store.put({ type: "memory", kind: "fact", title: "The otter survey", body: "The otter survey on the river counted eleven holts this spring." });
  const kite = store.put({ type: "memory", kind: "fact", title: "The kite festival", body: "The kite festival moved to the headland because of the wind." });
  for (let i = 0; i < 18; i += 1) {
    store.put({ type: "memory", kind: "fact", body: `Filler memory number ${i}: an unremarkable fact about ordinary things.` });
  }
  await backfillVectors({ counterpart: a.counterpart, embedder: emb });
  return { a, emb, otter, kite, turns };
}

interface Delivered {
  semantic: string;
  semanticFrom: number | null;
  /** Each candidate's semantic score, from the durable decision row. */
  semanticOf: (id: string) => number;
}

/** One prompt through the UserPromptSubmit hook, read back from the rows it left. */
function prompt(w: World, session: string, text: string): Delivered {
  const input = toHookInput(
    { session_id: session, hook_event_name: "UserPromptSubmit", cwd: SCOPE, prompt: text },
    { scope: SCOPE, timeZone: ZONE, env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_SESSION_ATTENDED: "1" }, dataDir: w.a.counterpart.store.dir },
  );
  w.a.userPromptSubmit(input);
  // The newest row of each for THIS session (the adapter's row names its session in the payload).
  const last = (name: string): Record<string, unknown> => {
    const rows = w.a.counterpart.store.eventLog({ name, order: "desc", limit: 50 });
    const mine = rows.map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>).find((p) => p["session"] === session || p["sessionId"] === session);
    expect(mine).toBeDefined();
    return mine ?? {};
  };
  const delivered = last(RECALL_DELIVERED_EVENT);
  // The scores are not on any durable row: read them off the result the hook itself got back.
  const result = w.turns.mock.results.at(-1)?.value as { decision: { sessionId: string; verdicts: { id: string; semantic: number }[] } } | undefined;
  expect(result?.decision.sessionId).toBe(session);
  const decision = result?.decision;
  return {
    semantic: delivered["semantic"] as string,
    semanticFrom: (delivered["semanticFrom"] as number | null | undefined) ?? null,
    semanticOf: (id) => decision?.verdicts.find((v) => v.id === id)?.semantic ?? 0,
  };
}

/** The Stop's half: the exchange captured, then the worker leaves the next turn's cue. */
async function worker(w: World, session: string, userText: string, reply: string): Promise<void> {
  w.a.counterpart.captureSpans({ session, scope: SCOPE, turns: [{ role: "user", text: userText }, { role: "assistant", text: reply }] });
  const lag = await laggedSemantic({ counterpart: w.a.counterpart, sessionId: session, scope: SCOPE, embedder: w.emb });
  expect(lag.reason).toBe("ok");
}

describe("the meaning lookup reads this turn (SEMANTIC_THIS_TURN)", () => {
  test("default on, and settable from outside", () => {
    expect(RECALL.SEMANTIC_THIS_TURN).toBe(true);
    expect(parseSetting("recall.SEMANTIC_THIS_TURN=false").value).toBe(false);
  });

  test("turn 2 with a fresh lag row: ON ranks its own prompt, OFF the previous exchange", async () => {
    for (const on of [true, false]) {
      const w = await world(on);
      const first = prompt(w, "s-two", "Tell me about the kite festival.");
      expect(first.semantic).toBe("in-line");
      await worker(w, "s-two", "Tell me about the kite festival.", "It moved to the headland.");
      // The worker's row is fresh for turn 2 in both arms.
      expect(w.a.counterpart.store.gateRecords("s-two").some((r) => r.kind === "semantic")).toBe(true);

      const second = prompt(w, "s-two", MEANING_ONLY);
      if (on) {
        expect(second.semantic).toBe("in-line");
        expect(second.semanticFrom).toBeNull();
        // This turn's meaning: the otter memory, which no word of the prompt names.
        expect(second.semanticOf(w.otter)).toBeGreaterThan(0);
        expect(second.semanticOf(w.kite)).toBe(0);
      } else {
        expect(second.semantic).toBe("lagged");
        expect(second.semanticFrom).toBe(1);
        // The previous exchange's meaning: the kite memory, and not the otter.
        expect(second.semanticOf(w.kite)).toBeGreaterThan(0);
        expect(second.semanticOf(w.otter)).toBe(0);
      }
      // The worker's row is left in place either way: the in-line turn writes no row of its own.
      expect(w.a.counterpart.store.gateRecords("s-two").filter((r) => r.kind === "semantic").length).toBe(1);
    }
  });

  test("past the count guard: a fresh lag row is used and recorded `lagged`; without one, `in-line-skipped`", async () => {
    const w = await world(true, { SEMANTIC_INLINE_MAX_VECTORS: 5 });
    expect(w.a.counterpart.store.embeddingCount()).toBeGreaterThan(5);
    const first = prompt(w, "s-big", "Tell me about the kite festival.");
    expect(first.semantic).toBe("in-line-skipped");
    await worker(w, "s-big", "Tell me about the kite festival.", "It moved to the headland.");

    const second = prompt(w, "s-big", MEANING_ONLY);
    expect(second.semantic).toBe("lagged");
    expect(second.semanticFrom).toBe(1);
    expect(second.semanticOf(w.kite)).toBeGreaterThan(0);
    expect(second.semanticOf(w.otter)).toBe(0);

    // Turn 3 with no worker in between: the row is stale, and the guard still holds.
    const third = prompt(w, "s-big", MEANING_ONLY);
    expect(third.semantic).toBe("in-line-skipped");
    expect(third.semanticOf(w.otter)).toBe(0);
  });

  test("a session's first prompt is unchanged: in line, on or off", async () => {
    for (const on of [true, false]) {
      const w = await world(on);
      const first = prompt(w, "s-first", MEANING_ONLY);
      expect(first.semantic).toBe("in-line");
      expect(first.semanticFrom).toBeNull();
      expect(first.semanticOf(w.otter)).toBeGreaterThan(0);
    }
  });

  test("deliberate recall is unchanged: its own vector, on or off, and the lag row is not read or spent", async () => {
    for (const on of [true, false]) {
      const w = await world(on);
      prompt(w, "s-ask", "Tell me about the kite festival.");
      await worker(w, "s-ask", "Tell me about the kite festival.", "It moved to the headland.");
      const before = JSON.stringify(w.a.counterpart.store.gateRecords("s-ask").filter((r) => r.kind === "semantic"));

      const server = new McpServer({ counterpart: w.a.counterpart, session: "s-ask", scope: SCOPE, registryDir: w.a.counterpart.store.dir, embedder: w.emb });
      const r = await server.call("recall", { session: "s-ask", question: MEANING_ONLY, mode: "meaning" });
      expect(r.isError).not.toBe(true);
      const out = r.structuredContent as Record<string, unknown>;
      expect(out["semantic"]).toBe("in-line");
      expect(JSON.stringify(out)).toContain(w.otter);
      expect(JSON.stringify(w.a.counterpart.store.gateRecords("s-ask").filter((r2) => r2.kind === "semantic"))).toBe(before);

      // And the session's next ambient turn reads as the switch says, the ask between notwithstanding.
      const next = prompt(w, "s-ask", MEANING_ONLY);
      expect(next.semantic).toBe(on ? "in-line" : "lagged");
    }
  });
});
