/**
 * `adapters/claude-code/` — the launch adapter, with the host faked.
 *
 * The host is faked in one direction only: its EVENTS and its transcript. Every
 * other thing under test is the real object — a real `Counterpart` over a real
 * temp data dir, the real span buffer, the real gate battery. What a fake host
 * buys is determinism about the one surface this adapter exists to isolate.
 *
 * NO TEST HERE MAKES A NETWORK CALL. `interpretClient` takes its `fetch`, and
 * every test supplies one; a test that reached the real API would be exactly the
 * "verified live" claim this suite is not entitled to make.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { OK_STOP_REASONS, TUNABLES as REMEMBER, validateWatchdog } from "../src/core/remember/index.js";
import { BOOTSTRAP } from "../src/core/self/index.js";
import {
  API_KEY_ENV,
  AUTHORSHIP_ASK,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  DATA_DIR_ENV,
  HOOKS,
  InterpretError,
  SESSION_ENDING,
  TUNABLES,
  capabilities,
  extractJson,
  interpretClient,
  loadConfig,
  openAdapter,
  parseTranscript,
  planSpawn,
  seatStatus,
  spawnDetached,
  substanceOf,
} from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput, HookName, SpawnPlan } from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;

let dir: string;
let priorEnv: string | undefined;
let priorKey: string | undefined;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorKey = process.env[API_KEY_ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-cc-"));
  process.env[ENV] = dir;
  process.env[API_KEY_ENV] = "sk-ant-test-not-a-real-key";
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  if (priorKey === undefined) delete process.env[API_KEY_ENV];
  else process.env[API_KEY_ENV] = priorKey;
  rmSync(dir, { recursive: true, force: true });
});

/** A spawner that starts nothing and records the plan it was handed. */
function fakeSpawner(): { calls: SpawnPlan[]; spawner: (p: SpawnPlan) => { pid: number } } {
  const calls: SpawnPlan[] = [];
  return {
    calls,
    spawner: (p: SpawnPlan) => {
      calls.push(p);
      return { pid: 4242 };
    },
  };
}

function config(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return { dataDir: dir, injectionBudgetBytes: BUDGET_BYTES, owner: true, ...over };
}

function adapter(over: Partial<AdapterConfig> = {}): {
  a: ClaudeCodeAdapter;
  calls: SpawnPlan[];
} {
  const { calls, spawner } = fakeSpawner();
  const a = openAdapter(config(over), { command: "/bin/true", args: ["runner"], spawner });
  open.push(a.counterpart);
  return { a, calls };
}

const TURNS = [
  { role: "user" as const, text: "We settled the storage split today: canonical prose on disk, one small operational database, and a cache nobody backs up." },
  { role: "assistant" as const, text: "Recorded. The cache being rebuildable is what makes the backup set small enough to be honest about." },
  { role: "user" as const, text: "Right — a backup you cannot verify is a backup you do not have, and that is the whole reason for the split." },
];

function input(over: Partial<HookInput> = {}): HookInput {
  return { sessionId: "s1", scope: "proj", turns: TURNS, at: "2026-01-02", ...over };
}

/** A fake SSE body: the exact frames the real endpoint emits, and nothing else. */
function sse(frames: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function streamed(text: string, stopReason = "end_turn"): ReadableStream<Uint8Array> {
  return sse([
    `event: message_start\ndata: {"type":"message_start"}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason } })}\n\n`,
    `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
  ]);
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200 });
}

// ═══════════════════════════════════════════════════════════════════════════
// The dependency direction, and the enumeration of session-ending paths
// ═══════════════════════════════════════════════════════════════════════════
describe("the adapter is a leaf — and every session-ending path is enumerated", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));

  function tsFiles(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) out.push(...tsFiles(full));
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  test("the CORE imports nothing from any adapter (CONTRACT §5 G1, constitution 5)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(join(SRC, "core"))) {
      const text = readFileSync(file, "utf8");
      if (/from\s+"[^"]*adapters\//.test(text)) offenders.push(file.slice(SRC.length));
    }
    expect(offenders).toEqual([]);
  });

  test("exactly ONE file reaches a model API, and no SDK is imported anywhere (scar E2's chokepoint)", () => {
    const endpoints: string[] = [];
    const callers: string[] = [];
    for (const file of tsFiles(SRC)) {
      const raw = readFileSync(file, "utf8");
      // NOTE: line-comment stripping eats `https://…`, so the endpoint scan runs
      // on the raw text — which is stricter, not looser.
      if (/api\.anthropic\.com/.test(raw)) endpoints.push(file.slice(SRC.length));
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
      // Zero runtime dependencies: no SDK import anywhere in the package.
      expect({ file: file.slice(SRC.length), sdk: /from\s+"@anthropic-ai\//.test(text) }).toEqual({
        file: file.slice(SRC.length),
        sdk: false,
      });
      // The only place that resolves a network verb at all.
      if (/globalThis[^\n]*fetch|doFetch\s*\(/.test(text)) callers.push(file.slice(SRC.length));
    }
    expect(endpoints).toEqual(["adapters/claude-code/config.ts"]);
    expect(callers).toEqual(["adapters/claude-code/interpret-client.ts"]);
  });

  test("every session-ending host event is wired, and each maps to a boundary kind", () => {
    expect([...SESSION_ENDING].sort()).toEqual(["pre-compact", "session-end", "stop"]);
    expect(Object.keys(BOUNDARY_KIND).sort()).toEqual([...SESSION_ENDING].sort());
    // And every one of them is a hook the dispatcher actually knows.
    for (const hook of SESSION_ENDING) expect(HOOKS).toContain(hook);
  });

  test("EVERY session-ending path claims spans — compaction must not destroy the day (§2 G5)", () => {
    for (const hook of SESSION_ENDING) {
      const { a } = adapter();
      // Distinct text per path: content-hash dedup is layer 2 and would
      // otherwise make the second path look like a path that did not capture.
      const result = a.hook(
        hook as HookName,
        input({
          sessionId: `s-${hook}`,
          turns: TURNS.map((t) => ({ ...t, text: `${t.text} (${hook})` })),
        }),
      );
      expect({ hook, spans: result.spansAppended > 0 }).toEqual({ hook, spans: true });
      // The boundary RECORD exists too, with this path's own kind on it.
      const boundaries = a.counterpart.spans.boundaries("proj");
      expect(boundaries.map((b) => b.kind)).toContain(BOUNDARY_KIND[hook]);
      expect(boundaries.every((b) => b.askRaised)).toBe(true);
      a.counterpart.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The wake: sentinel, budget, tripwire, delivery
// ═══════════════════════════════════════════════════════════════════════════
describe("session-start — the injection carries a sentinel and honours the HOST's budget", () => {
  test("a fresh store injects the bootstrap line and never fails the session (§1 G7)", () => {
    const { a } = adapter();
    const result = a.sessionStart(input());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("absent");
    expect(result.injection).toBe(BOOTSTRAP);
  });

  test("a published bundle is injected WITH its sentinel, and the sentinel is the last line", async () => {
    const { a } = adapter();
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const result = a.sessionStart(input());
    expect(result.ok).toBe(true);
    expect(result.sentinel).not.toBe(null);
    expect(result.injection.trimEnd().endsWith(result.sentinel as string)).toBe(true);
    // The sentinel states the bundle's own byte count, so truncation is
    // detectable from a preview alone (§1 G2, scar §2.3).
    expect(result.sentinel).toContain(`bytes=${result.bytes}`);
  });

  test("the budget REPORTED BY THE HOST is what the briefing composes to", async () => {
    const roomy = adapter({ injectionBudgetBytes: BUDGET_BYTES });
    for (let i = 0; i < 8; i += 1) {
      roomy.a.counterpart.store.put({
        type: "memory",
        kind: "fact",
        body: `A memory the briefing might carry, number ${i}, with words of its own to spend bytes on.`,
        salience: { novelty: null, relevance: 0.8, emotional: 0.6, predictive: 0.7 },
        physics: { birthDay: 0, lastUsedDay: 0 },
      });
    }
    await roomy.a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const big = roomy.a.sessionStart(input()).bytes;
    expect(big).toBeGreaterThan(0);

    await roomy.a.counterpart.sessionEnd({ date: "2026-01-03", budgetBytes: 400 });
    const cramped = openAdapter(config({ injectionBudgetBytes: 400 }), { spawner: fakeSpawner().spawner });
    open.push(cramped.counterpart);
    const small = cramped.sessionStart(input()).bytes;
    expect(small).toBeLessThan(big);
    expect(small).toBeLessThanOrEqual(400);
  });

  test("NO reported ceiling is a TRIPWIRE, not an invented number (scar §2.18)", () => {
    const { a } = adapter({ injectionBudgetBytes: undefined });
    a.sessionStart(input());
    expect(a.events("adapter.budget.unreported").length).toBe(1);
    expect(a.counterpart.budgetBytes()).toBe(null);
    // And the capability report says so, rather than showing a default.
    const row = a.capabilities().find((c) => c.name === "injectionBudgetBytes");
    expect(row?.reported).toBe(false);
    expect(row?.value).toBe(null);
  });

  test("a bundle that EXCEEDS the reported ceiling is an event, never silent degradation", async () => {
    const { a } = adapter();
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    // The host now says it can carry far less than the published bundle.
    const tiny = openAdapter(config({ injectionBudgetBytes: 10 }), { spawner: fakeSpawner().spawner });
    open.push(tiny.counterpart);
    const result = tiny.sessionStart(input());
    expect(tiny.events("adapter.injection.overbudget").length).toBe(1);
    // It still goes: truncated-and-detectable beats absent (§1 G7).
    expect(result.injection.length).toBeGreaterThan(0);
  });

  test("delivery telemetry is DISTINCT from render telemetry (scar §2.3)", async () => {
    const { a } = adapter();
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const woke = a.sessionStart(input());

    a.userPromptSubmit(input({ prompt: "hello", sentinelSeen: woke.sentinel }));
    expect(a.events("adapter.wake.delivered")[0]?.data?.delivered).toBe(true);

    // The truncated case: the host never got the last line.
    a.userPromptSubmit(input({ sessionId: "s2", prompt: "hello", sentinelSeen: null }));
    const records = a.events("adapter.wake.delivered");
    expect(records[records.length - 1]?.data?.delivered).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The turn hook
// ═══════════════════════════════════════════════════════════════════════════
describe("user-prompt-submit — recall injection, footnote tier, and the anti-loop guard", () => {
  function seeded(): ReturnType<typeof adapter> {
    const made = adapter();
    for (const body of [
      "The garage door opener needs a new battery soon.",
      "Rebasing keeps the history readable for reviewers.",
      "The library closes early on Sundays now.",
      "The kitchen tap drips when the pressure is high.",
      "The bus route changed and adds ten minutes.",
      "Planted three tomato seedlings in the planter.",
      "The storage split keeps canonical prose in markdown files that any editor can open.",
    ]) {
      made.a.counterpart.store.put({
        type: "memory",
        kind: "fact",
        body,
        salience: { novelty: null, relevance: 0.7, emotional: 0.5, predictive: 0.6 },
        physics: { birthDay: 0, lastUsedDay: 0 },
      });
    }
    return made;
  }

  test("a cued turn injects, and the loud and footnote tiers come back SEPARATELY", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "how does the storage split work" }));
    const reached = [...result.surfaced, ...result.footnotes];
    expect(reached.length).toBeGreaterThan(0);
    expect(result.injection.length).toBeGreaterThan(0);
    expect(result.sentinel).not.toBe(null);
    // Two lists, not one: a footnote trains nothing, and the caller has to be
    // able to tell them apart to credit correctly (§9, §5.5).
    expect(result.surfaced.some((id) => result.footnotes.includes(id))).toBe(false);
  });

  test("a quiet turn injects the EMPTY STRING, never an empty block", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "zygomorphic vellichor quixotry" }));
    expect(result.injection).toBe("");
    expect(result.ok).toBe(true);
  });

  test("an empty prompt is a quiet hook, not a failure", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "   " }));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("empty-prompt");
    expect(result.injection).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The boundary appender: microseconds, no throw, no re-encode
// ═══════════════════════════════════════════════════════════════════════════
describe("the boundary is an APPENDER — it never throws into the host (§2 G1/G12)", () => {
  test("a boundary whose span write is impossible still returns cleanly", () => {
    const { a } = adapter();
    // FAULT INJECTION at the durable layer: the spans root is replaced with a
    // file, so every append under it fails with ENOTDIR.
    a.counterpart.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    rmSync(join(dir, "spans"), { recursive: true, force: true });
    Bun.write(join(dir, "spans"), "not a directory");

    for (const hook of SESSION_ENDING) {
      const result = a.hook(hook as HookName, input({ sessionId: `fault-${hook}` }));
      expect({ hook, ok: result.ok }).toEqual({ hook, ok: true });
      expect(result.spansAppended).toBe(0);
    }
  });

  test("a hook whose CORE throws is logged and swallowed (G2)", () => {
    const { a } = adapter();
    // The store is closed underneath: every call into it now throws.
    a.counterpart.store.close();
    const result = a.stop(input({ sessionId: "closed" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("failed");
    expect(a.events("adapter.hook.failed").length).toBeGreaterThan(0);
    open.length = 0;
  });

  test("the re-entrancy guard stops a hook recalling on its own injection", () => {
    const { a } = adapter();
    let inner: ReturnType<ClaudeCodeAdapter["userPromptSubmit"]> | null = null;
    const nested = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(nested.counterpart);
    // Re-entry is simulated by calling the hook from inside its own telemetry —
    // which is exactly the shape a host that re-fires on injected text produces.
    const guarded = new ClaudeCodeAdapter({
      counterpart: nested.counterpart,
      config: config(),
      spawner: fakeSpawner().spawner,
      onEvent: (e) => {
        if (e.name === "adapter.recall" && inner === null) {
          inner = guarded.userPromptSubmit(input({ prompt: "the same turn again" }));
        }
      },
    });
    guarded.userPromptSubmit(input({ prompt: "the storage split" }));
    expect(inner).not.toBe(null);
    expect((inner as unknown as { reason: string }).reason).toBe("reentrant");
    expect(guarded.events("adapter.reentrant").length).toBe(1);
  });

  test("a COMPACTION re-read does not re-encode: the cursor advanced after the append (G8)", () => {
    const { a } = adapter();
    const first = a.preCompact(input());
    expect(first.spansAppended).toBeGreaterThan(0);
    const after = a.counterpart.spans.spans("proj").length;

    // The host hands the SAME transcript again — the case v1 hypothesised and
    // never verified. The per-session cursor is already past it.
    const second = a.preCompact(input());
    expect(second.spansAppended).toBe(0);
    expect(a.counterpart.spans.spans("proj").length).toBe(after);

    // And an OVERLAPPING slice (the same prefix plus one new turn) appends only
    // once more, because the cursor decides what is new — not the hash alone.
    const grown = a.stop(input({ turns: [...TURNS, { role: "user", text: "One more thing before we stop for the day." }] }));
    expect(grown.spansAppended).toBeGreaterThan(0);
    expect(a.counterpart.spans.spans("proj").length).toBe(after + grown.spansAppended);
  });

  test("injected context is KEPT in capture and EXCLUDED from pacing (§2 G10/G11)", () => {
    const turns = [
      { role: "user" as const, text: "The real question the user asked, in their own words." },
      { role: "user" as const, text: "<system-reminder>host-injected context</system-reminder>", source: "injected" as const },
      { role: "user" as const, text: "tool output nobody said", source: "tool" as const },
    ];
    expect(substanceOf(turns)).toEqual({
      turns: 1,
      bytes: Buffer.byteLength(turns[0]?.text ?? "", "utf8"),
    });

    const { a } = adapter();
    a.stop(input({ turns }));
    const captured = a.counterpart.spans.spans("proj").map((s) => s.text).join("\n");
    expect(captured).toContain("in their own words");
    expect(captured).toContain("host-injected context");
    expect(captured).not.toContain("tool output nobody said");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Stop: the ask, and the detached worker
// ═══════════════════════════════════════════════════════════════════════════
describe("stop — one ask, committed before it blocks, and a detached worker", () => {
  test("the ask is raised once and its advance is already committed (§13 G3–G4)", () => {
    const { a } = adapter();
    const first = a.stop(input({ turns: bigTurns() }));
    expect(first.ask).not.toBe(null);
    expect(a.counterpart.self.episodeState("s1").chapters).toBeGreaterThan(0);
    // A second stop on the same substance is not due again.
    const second = a.stop(input({ turns: bigTurns() }));
    expect(second.ask).toBe(null);
  });

  test("stop raises the AUTHORSHIP ask while the experiencer still has the pen", async () => {
    const { a } = adapter();
    const first = a.stop(input());
    expect(first.authorshipAsk).toBe(AUTHORSHIP_ASK);
    const measured = a.events("adapter.authorship.ask")[0]?.data;
    expect(measured?.uncovered).toBeGreaterThan(0);
    // The unaskable tail is MEASURED at the same moment, not assumed (§2 G12).
    expect(typeof measured?.unaskableBytes).toBe("number");

    // Once the experiencer HAS written, the ask stops: the engine claimed the
    // coverage, so there is nothing uncovered left to ask about (§5 G5/G6).
    await a.counterpart.submitSessionEnd(
      {
        content: "The storage split keeps canonical prose in markdown, so the owner can read their own memory anywhere.",
        kind: "fact",
      },
      { session: "s1", scope: "proj" },
    );
    expect(a.stop(input({ sessionId: "s1b" })).authorshipAsk).toBe(null);
  });

  test("the authorship ask is fail-open: a broken measurement never costs the boundary", () => {
    const { a } = adapter();
    a.counterpart.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    rmSync(join(dir, "spans"), { recursive: true, force: true });
    Bun.write(join(dir, "spans"), "not a directory");
    const result = a.stop(input({ sessionId: "fail-open" }));
    // The boundary still returned cleanly; only the ask is absent.
    expect(result.ok).toBe(true);
    expect(result.authorshipAsk).toBe(null);
  });

  test("stop spawns a detached worker whose environment is PINNED LAST (scar §2.13)", () => {
    const { a, calls } = adapter();
    const result = a.stop(input());
    expect(result.spawn?.started).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.env[DATA_DIR_ENV]).toBe(dir);
    // Even when a caller exported a different one, the plan overwrites it.
    const plan = planSpawn({
      config: config(),
      command: "/bin/true",
      args: [],
      baseEnv: { ...process.env, [DATA_DIR_ENV]: "/somewhere/else" },
    });
    expect(plan.env[DATA_DIR_ENV]).toBe(dir);
  });

  test("the watchdog is VALIDATED against the claim-staleness window (SEAMS queued item 10)", () => {
    // The shipped default must actually pass, not merely be documented as safe.
    expect(validateWatchdog(TUNABLES.WATCHDOG_MS, REMEMBER.STALE_CLAIM_MS).ok).toBe(true);
    expect(planSpawn({ config: config(), command: "/bin/true", args: [] }).ok).toBe(true);

    const tooLong = planSpawn({
      config: config({ watchdogMs: REMEMBER.STALE_CLAIM_MS }),
      command: "/bin/true",
      args: [],
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reason).toBe("WATCHDOG_EXCEEDS_STALENESS");
  });

  test("a worker that CANNOT START escalates rather than re-logging (scar E4's widening)", () => {
    delete process.env[API_KEY_ENV];
    const { a } = adapter();
    let last = a.stop(input({ sessionId: "no-key-1" })).spawn;
    expect(last?.started).toBe(false);
    expect(last?.reason).toBe("NO_CREDENTIAL");
    expect(last?.escalate).toBe(false);

    for (let i = 2; i <= TUNABLES.ESCALATE_AFTER; i += 1) {
      last = a.stop(input({ sessionId: `no-key-${i}` })).spawn;
    }
    // The nth identical failure is an ESCALATION, not the same line again.
    expect(last?.escalate).toBe(true);
    expect(a.events("spawn.escalated").length).toBeGreaterThan(0);
  });

  test("an observer spawns NO worker, and says so (§15 G3)", () => {
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Counterpart.open({ dir, owner: true }).close();
    const { a, calls } = adapter({ observer: true });
    const result = a.stop(input());
    expect(result.reason).toBe("observer");
    expect(calls).toEqual([]);
    expect(a.events("adapter.observer.standdown").length).toBe(1);
    // And nothing was deposited: the instrument left the store as it found it.
    expect(a.counterpart.spans.spans("proj")).toEqual([]);
  });

  test("a spawn that FAILS to start is a named outcome, never a silent one", () => {
    const { a } = adapter();
    const failing = new ClaudeCodeAdapter({
      counterpart: a.counterpart,
      config: config(),
      spawner: () => {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      },
    });
    const result = failing.stop(input({ sessionId: "enoent" }));
    expect(result.spawn?.started).toBe(false);
    expect(result.spawn?.reason).toBe("SPAWN_FAILED");
    expect(result.spawn?.code).toBe("ENOENT");
    expect(failing.events("spawn.failed").length).toBe(1);
  });

  /** Past BOTH first-ask thresholds: 6 real turns AND 4,000 real bytes. */
  function bigTurns(): HookInput["turns"] {
    const body =
      "a real exchange with enough substance in it to pace a ritual honestly, said at the length people actually work at, which is what the byte half of the threshold is measuring rather than the turn half. ";
    return Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i}: ${body.repeat(2)}`,
    }));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// The interpret client — refusals BY NAME, and never a real socket
// ═══════════════════════════════════════════════════════════════════════════
describe("interpret-client — streaming, stop_reason guarded, credential from env only", () => {
  const chunk = {
    index: 0,
    spans: [],
    marked: [],
    prompt: "a transcript chunk nobody summarized",
    bytes: 34,
  };

  test("a clean stream returns the proposals it parsed, with the stop reason", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const interpret = interpretClient({
      config: config(),
      fetch: async (url, init) => {
        seen = { url, init };
        return okResponse(streamed('[{"content":"The cache is rebuildable, so it is never backed up.","kind":"fact"}]'));
      },
    });
    const result = await interpret(chunk);
    expect(result.stopReason).toBe("end_turn");
    expect(OK_STOP_REASONS).toContain(result.stopReason as string);
    expect(result.proposals?.length).toBe(1);

    // It STREAMED (scar E3) and it sent the credential as a header, not a query.
    const body = JSON.parse(String((seen as unknown as { init: RequestInit }).init.body)) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
    expect(body["model"]).toBe("claude-opus-5");
    expect((seen as unknown as { url: string }).url).toContain("api.anthropic.com");
  });

  test("a TRUNCATED response is a failure, not data — and the reason travels (scar E2)", async () => {
    const interpret = interpretClient({
      config: config(),
      fetch: async () => okResponse(streamed('[{"content":"half a memory', "max_tokens")),
    });
    const result = await interpret(chunk);
    expect(result.stopReason).toBe("max_tokens");
    expect(OK_STOP_REASONS).not.toContain(result.stopReason as string);
    // Nothing is handed back as data: `remember/` will file the chunk TRUNCATED.
    expect(result.proposals).toEqual([]);
  });

  test("a MISSING key refuses with the right reason, before any socket opens", async () => {
    delete process.env[API_KEY_ENV];
    let called = false;
    const interpret = interpretClient({
      config: config(),
      fetch: async () => {
        called = true;
        return okResponse(streamed("[]"));
      },
    });
    await expect(interpret(chunk)).rejects.toThrow(InterpretError);
    expect(called).toBe(false);
    try {
      await interpret(chunk);
    } catch (err) {
      expect((err as InterpretError).code).toBe("NO_API_KEY");
    }
  });

  test("the key comes from the ENVIRONMENT only — never from a file (scar §2.18)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/adapters/claude-code/interpret-client.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    expect(/readFileSync|readFile\(|existsSync/.test(code)).toBe(false);
    expect(code).toContain("process.env[API_KEY_ENV]");
  });

  test("an EXPIRED placeholder seat refuses the call — 'never decided' cannot pass for decided", async () => {
    const expired = seatStatus("interpret", { id: "some-alias", placeholder: true, expires: "2026-01-01" }, "2026-06-01");
    expect(expired.status).toBe("expired");
    expect(expired.usable).toBe(false);
    // A placeholder with NO expiry is refused outright — that is the shape that
    // becomes production by silence (scar §2.15c).
    expect(seatStatus("interpret", { id: "x", placeholder: true }, "2026-06-01").status).toBe(
      "unbounded-placeholder",
    );

    const interpret = interpretClient({
      config: config({ models: { interpret: { id: "x", placeholder: true, expires: "2026-01-01" } } }),
      today: "2026-06-01",
      fetch: async () => okResponse(streamed("[]")),
    });
    try {
      await interpret(chunk);
      throw new Error("did not refuse");
    } catch (err) {
      expect((err as InterpretError).code).toBe("SEAT_UNUSABLE");
    }
  });

  test("an HTTP error refuses by name and carries its status", async () => {
    const interpret = interpretClient({
      config: config(),
      fetch: async () => new Response("nope", { status: 429 }),
    });
    try {
      await interpret(chunk);
      throw new Error("did not refuse");
    } catch (err) {
      expect((err as InterpretError).code).toBe("HTTP_ERROR");
      expect((err as InterpretError).detail["status"]).toBe(429);
    }
  });

  test("the JSON is never sliced first-brace-to-last-brace (scar §2.14)", () => {
    // A bracket inside a string is exactly what breaks the naive slice.
    const text = 'Here you go: [{"content":"the ] bracket lives inside a string","kind":"fact"}] — done.';
    const parsed = extractJson(text);
    expect(parsed?.length).toBe(1);
    expect((parsed?.[0] as { content: string }).content).toContain("] bracket");
    // A preamble bracket that opens nothing is skipped, not fatal.
    expect(extractJson('[not json at all')).toBe(null);
    expect(extractJson("no array here")).toBe(null);
    expect(extractJson("[]")).toEqual([]);
  });

  test("a response with no array at all refuses — distinguishable from 'returned nothing'", async () => {
    const interpret = interpretClient({
      config: config(),
      fetch: async () => okResponse(streamed("I could not find anything worth remembering.")),
    });
    try {
      await interpret(chunk);
      throw new Error("did not refuse");
    } catch (err) {
      expect((err as InterpretError).code).toBe("NO_JSON_IN_RESPONSE");
    }
    // Whereas an EMPTY array is a real answer and is not a refusal.
    const empty = interpretClient({ config: config(), fetch: async () => okResponse(streamed("[]")) });
    expect((await empty(chunk)).proposals).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The detached worker, end to end, with a faked model
// ═══════════════════════════════════════════════════════════════════════════
describe("the runner — sweep then sleep, with the interpreter faked", () => {
  test("a run sweeps the captured spans, mints, and publishes a briefing the next wake reads", async () => {
    const { a } = adapter();
    a.stop(input());
    a.counterpart.close();
    open.length = 0;

    const events: string[] = [];
    const report = await runOnce({
      config: config(),
      today: "2026-01-02",
      date: "2026-01-02",
      fetch: async () =>
        okResponse(
          streamed(
            '[{"content":"The cache is rebuildable from canonical files, which is why it never enters the backup set.","kind":"fact","salience":{"relevance":0.9,"emotional":0.7,"predictive":0.8}}]',
          ),
        ),
      onEvent: (name) => events.push(name),
    });
    expect(report.ran).toBe(true);
    expect(report.minted).toBe(1);
    expect(events).toContain("runner.done");

    const next = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(next.counterpart);
    const woke = next.sessionStart(input());
    expect(woke.ok).toBe(true);
    expect(woke.injection).toContain("rebuildable");
  });

  test("a run with no data dir refuses by name and opens nothing", async () => {
    const report = await runOnce({ config: { injectionBudgetBytes: BUDGET_BYTES } });
    expect(report.ran).toBe(false);
    expect(report.reason).toBe("no-data-dir");
  });

  test("an observer run refuses: a cycle would mutate what the instrument measures", async () => {
    const report = await runOnce({ config: config({ observer: true }) });
    expect(report.ran).toBe(false);
    expect(report.reason).toBe("observer");
  });

  test("a refusing interpreter loses NO spans — the arc is retried, not lost (scar E6)", async () => {
    const { a } = adapter();
    a.stop(input());
    const before = a.counterpart.spans.spans("proj").length;
    a.counterpart.close();
    open.length = 0;

    await runOnce({
      config: config(),
      date: "2026-01-02",
      fetch: async () => new Response("upstream is down", { status: 503 }),
    });

    const after = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(after.counterpart);
    expect(after.counterpart.spans.spans("proj").length).toBe(before);
    expect(after.counterpart.store.list({ type: "memory" })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Configuration, capabilities, transcript reading
// ═══════════════════════════════════════════════════════════════════════════
describe("configuration — reported, checkable, and failing toward standing down", () => {
  test("an UNREADABLE configuration resolves to OBSERVER, never to 'encode anyway'", () => {
    expect(loadConfig({ injectionBudgetBytes: "nine thousand" }).config.observer).toBe(true);
    expect(loadConfig("not an object").reason).toBe("unreadable");
    expect(loadConfig({ models: { interpret: { id: 7 } } }).config.observer).toBe(true);
    // An ABSENT configuration is ordinary, and is not a stand-down.
    expect(loadConfig(undefined).config.observer).toBeUndefined();
    expect(loadConfig(undefined).ok).toBe(true);
  });

  test("a good configuration round-trips, and unknown fields do not smuggle a stance", () => {
    const loaded = loadConfig({
      dataDir: "/tmp/x",
      injectionBudgetBytes: 9000,
      owner: true,
      models: { interpret: { id: "claude-opus-5" } },
      identity: { name: "Mike", aliases: ["mike"] },
      somethingElse: 42,
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.config.injectionBudgetBytes).toBe(9000);
    expect(loaded.config.models?.interpret?.id).toBe("claude-opus-5");
    expect(loaded.config.identity?.name).toBe("Mike");
    expect(loaded.config.observer).toBeUndefined();
  });

  test("every host-dependent limit has a row, and 'we never asked' is visible", () => {
    const rows = capabilities({});
    expect(rows.map((r) => r.name).sort()).toEqual([
      "credential",
      "executionCeilingMs",
      "injectionBudgetBytes",
      "socketLifetimeMs",
    ]);
    for (const row of rows) {
      if (row.name === "credential") continue;
      expect({ name: row.name, reported: row.reported }).toEqual({ name: row.name, reported: false });
    }
    // The credential row reports on the ONE environment variable, live.
    expect(rows.find((r) => r.name === "credential")?.reported).toBe(true);
  });

  test("the transcript reader keeps conversation, tags injected, and drops the blind spot", () => {
    const raw = [
      JSON.stringify({ message: { role: "user", content: "What the user actually said." } }),
      JSON.stringify({ message: { role: "user", content: "<system-reminder>injected</system-reminder>" } }),
      JSON.stringify({
        message: { role: "assistant", content: [{ type: "text", text: "The reply." }, { type: "tool_use", name: "Bash" }] },
      }),
      "{ not json",
    ].join("\n");
    const read = parseTranscript(raw);
    expect(read.corrupt).toBe(1);
    expect(read.turns.map((t) => t.source)).toEqual(["conversation", "injected", "conversation"]);
    expect(read.turns.map((t) => t.text)).toEqual([
      "What the user actually said.",
      "<system-reminder>injected</system-reminder>",
      "The reply.",
    ]);
    expect(parseTranscript("").turns).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Caller universality (SEAMS queued item 12): every entrance is gated
// ═══════════════════════════════════════════════════════════════════════════
describe("every ingestion entrance this adapter creates goes through the battery", () => {
  const CREDENTIAL = "AKIAIOSFODNN7EXAMPLE";

  test("the entrances are enumerated, and each one refuses or redacts a credential", async () => {
    const { a } = adapter();
    const c = a.counterpart;

    // 1. The authored session-end dump.
    const dump = await c.submitSessionEnd(
      { content: `The deploy key ${CREDENTIAL} is the one to rotate this quarter.`, kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(dump.deposited).toBe(true);
    expect(c.store.readProse(dump.memoryId as string).body).not.toContain(CREDENTIAL);

    // 2. The in-the-moment jot.
    const jot = await c.submitJot(
      { content: `A jot mentioning ${CREDENTIAL} in passing while we worked.`, kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(jot.deposited).toBe(true);
    expect(c.store.readProse(jot.memoryId as string).body).not.toContain(CREDENTIAL);

    // 3. The episode.
    c.episodeAsk("s1", { turns: 12, bytes: 9_000 });
    c.appendEpisode("s1", `I finally rotated ${CREDENTIAL} today and the relief was real.`);
    const episode = c.ingestEpisode({ sessionId: "s1" });
    expect(episode.ingested).toBe(true);
    expect(c.store.readProse(episode.memoryId as string).body).not.toContain(CREDENTIAL);

    // 4. The crash-fallback sweep, through the adapter's own hook path.
    a.stop(input({ sessionId: "s2" }));
    await c.sweepFallback({
      interpret: async () => ({
        proposals: [{ content: `The deploy key ${CREDENTIAL} was rotated during that session.`, kind: "fact" }],
        stopReason: "end_turn",
      }),
    });

    // The totality: NO canonical byte anywhere in the store holds the secret.
    const files: string[] = [];
    const walk = (root: string): void => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(readFileSync(full, "utf8"));
      }
    };
    walk(join(dir, "prose"));
    const prose = files.join("\n");
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).not.toContain(CREDENTIAL);
  });
});
