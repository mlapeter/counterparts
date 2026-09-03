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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Counterpart,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
} from "../src/core/counterpart.js";
import { indexTextOf } from "../src/core/store/index.js";
import { OK_STOP_REASONS, TUNABLES as REMEMBER, enters, validateWatchdog } from "../src/core/remember/index.js";
import { BOOTSTRAP } from "../src/core/self/index.js";
import {
  AB_DIR_ENV,
  API_KEY_ENV,
  AUTHORSHIP_ASK,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  DATA_DIR_ENV,
  DEFAULT_EMBED_MODEL,
  EMBED_KEY_ENV,
  EmbedError,
  FOREIGN_MARKERS,
  HOOKS,
  InterpretError,
  SESSION_ENDING,
  TUNABLES,
  VOYAGE_ENDPOINT,
  abDir,
  assignmentHealth,
  assignmentPath,
  capabilities,
  classifyBlock,
  createEmbedder,
  embedClient,
  extractJson,
  interpretClient,
  loadConfig,
  openAdapter,
  openEmbedder,
  parseTranscript,
  planSpawn,
  primacy,
  readAssignment,
  seatStatus,
  spawnDetached,
  substanceOf,
} from "../src/adapters/claude-code/index.js";
import type {
  AdapterConfig,
  FetchLike,
  HookInput,
  HookName,
  LiveEmbedder,
  SpawnPlan,
} from "../src/adapters/claude-code/index.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;

let dir: string;
let priorEnv: string | undefined;
let priorKey: string | undefined;
/** Saved and restored like the other two: a dev machine may really have one,
 *  and a suite that reads the developer's key is a suite that can lie about
 *  why it passed. */
let priorEmbedKey: string | undefined;
/** The A/B directory, redirected FOR THE WHOLE FILE. The owner's machine has a
 *  real `~/.memory-ab/assignment.json` — v1's live switch — and a test that
 *  read it would be reading production state and could flip with the day. */
let abHome: string;
let priorAbDir: string | undefined;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorKey = process.env[API_KEY_ENV];
  priorEmbedKey = process.env[EMBED_KEY_ENV];
  priorAbDir = process.env[AB_DIR_ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-cc-"));
  abHome = mkdtempSync(join(tmpdir(), "counterparts-ab-"));
  process.env[ENV] = dir;
  process.env[AB_DIR_ENV] = abHome;
  process.env[API_KEY_ENV] = "sk-ant-test-not-a-real-key";
  process.env[EMBED_KEY_ENV] = "pa-test-not-a-real-key";
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
  if (priorAbDir === undefined) delete process.env[AB_DIR_ENV];
  else process.env[AB_DIR_ENV] = priorAbDir;
  if (priorKey === undefined) delete process.env[API_KEY_ENV];
  else process.env[API_KEY_ENV] = priorKey;
  if (priorEmbedKey === undefined) delete process.env[EMBED_KEY_ENV];
  else process.env[EMBED_KEY_ENV] = priorEmbedKey;
  rmSync(dir, { recursive: true, force: true });
  rmSync(abHome, { recursive: true, force: true });
});

/** Write v1's assignment file into the redirected A/B directory. A string is
 *  written verbatim (that is how a torn or non-object file is spelled). */
function assign(value: Record<string, unknown> | string): void {
  mkdirSync(abHome, { recursive: true });
  writeFileSync(assignmentPath(), typeof value === "string" ? value : JSON.stringify(value));
}

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

  test("the network surface is ENUMERATED — two files, two endpoints, no SDK (scar E2's chokepoint)", () => {
    const endpoints: string[] = [];
    const callers: string[] = [];
    for (const file of tsFiles(SRC)) {
      const raw = readFileSync(file, "utf8");
      // NOTE: line-comment stripping eats `https://…`, so the endpoint scan runs
      // on the raw text — which is stricter, not looser.
      if (/api\.anthropic\.com|api\.voyageai\.com/.test(raw)) endpoints.push(file.slice(SRC.length));
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
      // Zero runtime dependencies: no SDK import anywhere in the package.
      expect({ file: file.slice(SRC.length), sdk: /from\s+"@anthropic-ai\//.test(text) }).toEqual({
        file: file.slice(SRC.length),
        sdk: false,
      });
      // Anything that could OPEN a connection, not just this package's idiom.
      //
      // The scan used to be `/globalThis…fetch|doFetch\(/` — which recognises
      // exactly the two clients that already exist and would wave through a
      // third written any other way. A raw `node:https` request, an `undici`
      // pool, a bare socket or a WebSocket are all egress, and none of them
      // mentions `fetch`. Naming the shapes is the point: a new one appearing is
      // a review event, and if that means a false positive on some future file
      // that merely imports `node:net` for something else, a reviewer reading
      // this list is exactly the outcome intended.
      const opensAConnection =
        /globalThis[^\n]*fetch|doFetch\s*\(/.test(text) ||
        /from\s+"node:(https?|net|tls|dgram)"/.test(text) ||
        /from\s+"(undici|node-fetch|axios|got|superagent)"/.test(text) ||
        /require\(\s*"node:(https?|net|tls)"\s*\)/.test(text) ||
        /\bnew\s+WebSocket\s*\(/.test(text) ||
        /\bnavigator\.sendBeacon\s*\(/.test(text) ||
        // A bare `fetch(` call that never touches `globalThis` — the shape the
        // original pattern was one keyword away from missing entirely.
        /(^|[^.\w])fetch\s*\(\s*(?:"|`|https?|url|endpoint|ENDPOINT)/m.test(text);
      if (opensAConnection) callers.push(file.slice(SRC.length));
    }
    // BOTH endpoints live in config.ts, where an owner can read the whole egress
    // surface of this package on one page — that is the property, not "one".
    expect(endpoints).toEqual(["adapters/claude-code/config.ts"]);
    // And exactly two files resolve a network verb, both named. The list is the
    // point: a third one appearing is a review event, not a merge.
    expect(callers.sort()).toEqual([
      "adapters/claude-code/embed-client.ts",
      "adapters/claude-code/interpret-client.ts",
    ]);
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

  test("the OWNER ANCHOR reaches the wire: a configured identity names the owner in `system` (review CRITICAL-2)", async () => {
    let seen: { init: RequestInit } | null = null;
    const interpret = interpretClient({
      config: config({ identity: { name: "Mike", aliases: ["mlapeter", "Michael"] } }),
      fetch: async (_url, init) => {
        seen = { init };
        return okResponse(streamed("[]"));
      },
    });
    await interpret(chunk);
    const body = JSON.parse(String((seen as unknown as { init: RequestInit }).init.body)) as Record<string, unknown>;
    const system = String(body["system"]);
    // The anchor, its aliases, and the leak guard all travel — the first real
    // run minted 15 person-memories under a confabulated name because nothing
    // anchored the owner, and an anchor without the guard is a mint source.
    expect(system).toContain("The person these transcripts belong to is Mike");
    expect(system).toContain("mlapeter, Michael");
    expect(system).toContain("context, not material");
    // The kinds are DEFINED, not just named (review HIGH: entity ~60% misfiled).
    expect(system).toContain("a durable named thing");
  });

  test("an UNCONFIGURED identity forbids guessing a name rather than anchoring one", async () => {
    let seen: { init: RequestInit } | null = null;
    const interpret = interpretClient({
      config: config(),
      fetch: async (_url, init) => {
        seen = { init };
        return okResponse(streamed("[]"));
      },
    });
    await interpret(chunk);
    const body = JSON.parse(String((seen as unknown as { init: RequestInit }).init.body)) as Record<string, unknown>;
    const system = String(body["system"]);
    expect(system).toContain("NEVER guess or introduce a name");
    expect(system).not.toContain("The person these transcripts belong to is");
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
// The primacy resolver — the parallel run's G3, and its fail direction
// ═══════════════════════════════════════════════════════════════════════════
describe("primacy — v2 delivers on ONE reading of v1's file and mutes on every other", () => {
  test("a missing DIRECTORY is a named stand-down, never a throw", () => {
    process.env[AB_DIR_ENV] = join(abHome, "nothing-here");
    expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "file-missing" });
    expect(readAssignment().state).toBe("missing");
  });

  test("a missing FILE in a present directory stands down the same way", () => {
    expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "file-missing" });
  });

  test("a TORN file is `unreadable` — mid-write is not an assignment", () => {
    assign('{"mode":"alternate-day","override":"eng');
    expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "unreadable" });
    expect(readAssignment().state).toBe("unreadable");
  });

  test("JSON that is not an OBJECT is `malformed`, distinct from unparseable", () => {
    assign('["engram"]');
    expect(primacy().reason).toBe("malformed");
    assign('"engram"');
    expect(primacy().reason).toBe("malformed");
    // A bare `null` parses and is not an object either.
    assign("null");
    expect(primacy().reason).toBe("malformed");
  });

  test("override `engram` is the ONLY reading that delivers — v2 holds the slot engram vacated", () => {
    assign({ mode: "alternate-day", anchor: "2026-07-17", override: "engram" });
    expect(primacy()).toEqual({ deliver: true, system: "v2", reason: "override-engram" });
    const read = readAssignment();
    expect({ ...read }).toEqual({
      override: "engram",
      mode: "alternate-day",
      anchor: "2026-07-17",
      state: "ok",
    });
  });

  test("override `bansai` mutes v2 by name — the ordinary v1 day", () => {
    assign({ mode: "alternate-day", anchor: "2026-07-17", override: "bansai" });
    expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "override-bansai" });
  });

  test("null, 'none' and any other string all read as ABSENT — v2 never guesses itself into speaking", () => {
    for (const override of [null, "none", "counterparts", "v2", ""]) {
      assign({ mode: "alternate-day", anchor: "2026-07-17", override });
      expect({ override, ...primacy() }).toEqual({
        override,
        deliver: false,
        system: "v1",
        reason: "override-absent",
      });
    }
    // And a file with no `override` key at all: day-alternation against a
    // system that no longer exists is exactly what must not turn v2 on.
    assign({ mode: "alternate-day", anchor: "2026-07-17" });
    expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "override-absent" });
  });

  test("assignmentHealth is true ONLY for bansai or engram, and reports mode advisorily", () => {
    assign({ mode: "alternate-day", anchor: "2026-07-17", override: "bansai" });
    expect(assignmentHealth()).toEqual({
      healthy: true,
      reason: "override-bansai",
      mode: "alternate-day",
      override: "bansai",
    });
    assign({ mode: "alternate-day", override: "engram" });
    expect(assignmentHealth().healthy).toBe(true);
    // The state the preflight exists to forbid: no override, so v1 falls back to
    // alternate-day against a retired engram and mutes ITSELF every other day
    // while v2 mutes every day. Neither resolver's own fail direction produces
    // this; only the pair does.
    assign({ mode: "alternate-day", anchor: "2026-07-17" });
    expect(assignmentHealth()).toEqual({
      healthy: false,
      reason: "override-absent",
      mode: "alternate-day",
      override: null,
    });
    process.env[AB_DIR_ENV] = join(abHome, "nothing-here");
    expect(assignmentHealth()).toEqual({
      healthy: false,
      reason: "file-missing",
      mode: null,
      override: null,
    });
  });

  test("MEMORY_AB_DIR is read at CALL TIME, never cached", () => {
    const second = mkdtempSync(join(tmpdir(), "counterparts-ab2-"));
    try {
      assign({ override: "engram" });
      expect(primacy().deliver).toBe(true);
      expect(abDir()).toBe(abHome);

      process.env[AB_DIR_ENV] = second;
      expect(abDir()).toBe(second);
      expect(assignmentPath()).toBe(join(second, "assignment.json"));
      // Same process, same module instance, different answer.
      expect(primacy()).toEqual({ deliver: false, system: "v1", reason: "file-missing" });

      writeFileSync(join(second, "assignment.json"), JSON.stringify({ override: "engram" }));
      expect(primacy().deliver).toBe(true);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The parallel run wired in: one voice (G3), an encode-only shadow (G5),
// and a mute with evidence behind it (G4)
// ═══════════════════════════════════════════════════════════════════════════
describe("parallel.enabled — the delivering hooks stand down, and capture does not", () => {
  const PARALLEL = { parallel: { enabled: true } } as const;

  test("the knob parses like every other, and a half-written one stands down", () => {
    expect(loadConfig({ parallel: { enabled: true } }).config.parallel).toEqual({ enabled: true });
    expect(loadConfig({ parallel: { enabled: false } }).config.parallel).toEqual({ enabled: false });
    for (const bad of [{ enabled: "yes" }, {}, [], null, true]) {
      const loaded = loadConfig({ parallel: bad });
      expect({ bad, ok: loaded.ok, observer: loaded.config.observer }).toEqual({
        bad,
        ok: false,
        observer: true,
      });
    }
  });

  test("session-start under a stand-down injects NOTHING and says why", () => {
    assign({ override: "bansai" });
    const { a } = adapter(PARALLEL);
    const result = a.sessionStart(input());
    expect({ injection: result.injection, sentinel: result.sentinel, reason: result.reason }).toEqual({
      injection: "",
      sentinel: null,
      reason: "primacy-standdown",
    });
    // The wake never ran, so there is no render record and no expectation set.
    expect(a.events("adapter.wake.injected")).toEqual([]);
    const standdown = a.events(PRIMACY_STANDDOWN_EVENT);
    expect(standdown.length).toBe(1);
    expect(standdown[0]?.data).toEqual({
      hook: "session-start",
      reason: "override-bansai",
      system: "v1",
      date: "2026-01-02",
      session: "s1",
    });
  });

  test("user-prompt-submit under a stand-down performs no recall", async () => {
    assign({ override: "bansai" });
    const { a } = adapter(PARALLEL);
    a.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body: "The storage split put canonical prose on disk and one small operational database.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.6, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const result = a.userPromptSubmit(input({ prompt: "what did we settle about storage?", sentinelSeen: "x" }));
    expect({ injection: result.injection, reason: result.reason, surfaced: result.surfaced }).toEqual({
      injection: "",
      reason: "primacy-standdown",
      surfaced: [],
    });
    expect(a.events("adapter.recall")).toEqual([]);
    // No render happened, so no delivery claim is made about one.
    expect(a.events("adapter.wake.delivered")).toEqual([]);
    expect(a.events(PRIMACY_STANDDOWN_EVENT)[0]?.data?.hook).toBe("user-prompt-submit");
  });

  test("stop under a stand-down still CAPTURES and still spawns — the shadow is encode-only (G5)", () => {
    assign({ override: "bansai" });
    const { a, calls } = adapter(PARALLEL);
    const result = a.stop(input());
    // The boundary happened: spans are in the buffer, the worker was planned.
    // (Two spans: the user's turns joined into one, the assistant's kept apart.)
    expect(result.spansAppended).toBe(2);
    expect(a.counterpart.spans.spans("proj").length).toBe(1);
    expect(a.counterpart.spans.assistantSpans("proj").length).toBe(1);
    expect(result.spawn?.started).toBe(true);
    expect(calls.length).toBe(1);
    // And NEITHER ask went out — no episode ask, no authorship ask (G5).
    expect({ ask: result.ask, authorshipAsk: result.authorshipAsk }).toEqual({
      ask: null,
      authorshipAsk: null,
    });
    expect(a.events("adapter.episode.ask")).toEqual([]);
    expect(a.events("adapter.authorship.ask")).toEqual([]);
    expect(a.events(PRIMACY_STANDDOWN_EVENT)[0]?.data?.hook).toBe("stop");
  });

  test("override engram: the delivering hooks behave EXACTLY as the non-parallel adapter, plus a deliver record", () => {
    assign({ override: "engram" });
    // The control runs on its own data dir: two adapters over one store share a
    // cursor and an episode clock, and the second would see the first's writes.
    const control = mkdtempSync(join(tmpdir(), "counterparts-cc-ctl-"));
    try {
      const { a } = adapter(PARALLEL);
      const plain = openAdapter(config({ dataDir: control }), {
        command: "/bin/true",
        args: ["runner"],
        spawner: fakeSpawner().spawner,
      });
      open.push(plain.counterpart);

      const pick = (r: ReturnType<ClaudeCodeAdapter["stop"]>): unknown => ({
        ok: r.ok,
        reason: r.reason,
        injection: r.injection,
        bytes: r.bytes,
        sentinel: r.sentinel,
        surfaced: r.surfaced,
        footnotes: r.footnotes,
        ask: r.ask,
        authorshipAsk: r.authorshipAsk,
        spansAppended: r.spansAppended,
        started: r.spawn?.started ?? null,
      });

      expect(pick(a.sessionStart(input()))).toEqual(pick(plain.sessionStart(input())));
      expect(pick(a.userPromptSubmit(input({ prompt: "what about storage?" })))).toEqual(
        pick(plain.userPromptSubmit(input({ prompt: "what about storage?" }))),
      );
      const parallelStop = a.stop(input());
      expect(pick(parallelStop)).toEqual(pick(plain.stop(input())));
      expect(parallelStop.authorshipAsk).toBe(AUTHORSHIP_ASK);

      // The only difference: three deliver records, one per delivering hook.
      expect(a.events(PRIMACY_DELIVER_EVENT).map((e) => e.data?.hook)).toEqual([
        "session-start",
        "user-prompt-submit",
        "stop",
      ]);
      expect(a.events(PRIMACY_STANDDOWN_EVENT)).toEqual([]);
      expect(plain.events(PRIMACY_DELIVER_EVENT)).toEqual([]);
    } finally {
      rmSync(control, { recursive: true, force: true });
    }
  });

  test("with NO `parallel` block the resolver is never consulted at all", () => {
    // The file says stand down, loudly. Without the knob it is not even read.
    assign({ override: "bansai" });
    const { a } = adapter();
    a.sessionStart(input());
    a.userPromptSubmit(input({ prompt: "what about storage?" }));
    const stopped = a.stop(input());
    expect(a.events(PRIMACY_STANDDOWN_EVENT)).toEqual([]);
    expect(a.events(PRIMACY_DELIVER_EVENT)).toEqual([]);
    expect(stopped.authorshipAsk).toBe(AUTHORSHIP_ASK);
    expect(a.counterpart.store.eventLog({ limit: 100 }).map((r) => r.name)).not.toContain(
      PRIMACY_STANDDOWN_EVENT,
    );
  });

  test("the DELIVERY is evidenced too: wake, recall, delivery-check and episode-ask rows are durable (G2/G4)", () => {
    // In Phase S v2 is the muted side, so a v2 delivery event IS the
    // contamination detector — and a detector that lives only in the hook
    // process's ring cannot be counted after the process is gone. Every
    // delivering hook leaves a box-2 row carrying the calendar date and the
    // session; counts, bytes, reasons and flags only.
    assign({ override: "engram" });
    const { a } = adapter(PARALLEL);
    a.sessionStart(input());
    a.userPromptSubmit(input({ prompt: "what about storage?", sentinelSeen: "nope" }));
    a.stop(input());
    const store = a.counterpart.store;
    const rows = (name: string): Record<string, unknown>[] =>
      store
        .eventLog({ name, limit: 100 })
        .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    for (const name of ["adapter.wake.injected", "adapter.wake.delivered", "adapter.recall", "adapter.episode.ask"]) {
      const got = rows(name);
      expect(got.length).toBe(1);
      expect(got[0]?.["date"]).toBe("2026-01-02");
      expect(got[0]?.["session"]).toBe("s1");
      for (const v of Object.values(got[0] ?? {})) expect(["string", "number", "boolean"].includes(typeof v) || v === null).toBe(true);
    }
    expect(typeof rows("adapter.wake.injected")[0]?.["bytes"]).toBe("number");
    expect(typeof rows("adapter.recall")[0]?.["surfaced"]).toBe("number");
    // And under a stand-down none of the three delivering rows is added — the
    // absence is the mute. (Same store as above: count, do not assert empty.)
    const DELIVERING = ["adapter.wake.injected", "adapter.recall", "adapter.episode.ask"];
    const before = DELIVERING.map((name) => rows(name).length);
    assign({ override: "bansai" });
    const { a: muted } = adapter(PARALLEL);
    muted.sessionStart(input());
    muted.userPromptSubmit(input({ prompt: "what about storage?" }));
    muted.stop(input());
    expect(DELIVERING.map((name) => muted.counterpart.store.eventLog({ name, limit: 100 }).length)).toEqual(before);
    for (const name of DELIVERING) expect(muted.events(name)).toEqual([]);
  });

  test("every session-ending path leaves a DURABLE boundary row — session-end and pre-compact included", () => {
    assign({ override: "bansai" });
    const { a } = adapter(PARALLEL);
    a.sessionEnd(input());
    a.preCompact(input({ sessionId: "s2" }));
    a.stop(input({ sessionId: "s3" }));
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.boundary", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.map((r) => [r["hook"], r["session"], r["date"]])).toEqual([
      ["session-end", "s1", "2026-01-02"],
      ["pre-compact", "s2", "2026-01-02"],
      ["stop", "s3", "2026-01-02"],
    ]);
    for (const r of rows) for (const v of Object.values(r)) expect(["string", "number", "boolean"].includes(typeof v) || v === null).toBe(true);
  });

  test("the mute is EVIDENCED: the day's stand-downs are countable out of the store (G4)", () => {
    assign({ override: "bansai" });
    const { a } = adapter(PARALLEL);
    a.sessionStart(input());
    a.userPromptSubmit(input({ prompt: "what about storage?" }));
    a.stop(input());

    // Read back the way `tools/replay/driver.ts` reads `gate.chunk`: by name,
    // out of box 2, after the fact — not out of the adapter's in-process ring.
    const rows = a.counterpart.store.eventLog({ name: PRIMACY_STANDDOWN_EVENT, limit: 100 });
    expect(rows.length).toBe(3);
    const payloads = rows.map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(payloads.map((p) => p["hook"])).toEqual([
      "session-start",
      "user-prompt-submit",
      "stop",
    ]);
    // The calendar date rides in the payload: the log's `day` column is the
    // store's LIVED day, which no hook advances.
    expect(new Set(payloads.map((p) => p["date"]))).toEqual(new Set(["2026-01-02"]));
    expect(new Set(payloads.map((p) => p["reason"]))).toEqual(new Set(["override-bansai"]));
    const perDay = payloads.filter((p) => p["date"] === "2026-01-02").length;
    expect(perDay).toBe(3);
  });

  test("an OBSERVER's stand-down costs no boundary — the durable write refuses without throwing", () => {
    assign({ override: "bansai" });
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Counterpart.open({ dir, owner: true }).close();
    const { a } = adapter({ ...PARALLEL, observer: true });
    const result = a.sessionStart(input());
    expect(result.ok).toBe(true);
    // The ring still carries it (a stand-down must be observable), and the
    // store refused the append rather than failing the hook.
    expect(a.events(PRIMACY_STANDDOWN_EVENT).length).toBe(1);
    expect(a.events("adapter.hook.failed")).toEqual([]);
    expect(a.counterpart.store.eventLog({ name: PRIMACY_STANDDOWN_EVENT, limit: 10 })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G8 — foreign injection: another memory system's text never enters capture
// ═══════════════════════════════════════════════════════════════════════════
describe("the transcript reader excludes FOREIGN injection (parallel-run G8)", () => {
  const FOREIGN = [
    "Stop hook feedback:\n- [bansai] Before this session closes, what did you learn?",
    "Stop hook feedback: [bansai] anything worth keeping?",
    "[bansai] recall: three memories bear on this turn.",
    "<bansai-memory>\nthe standing bundle\n</bansai-memory>",
    "The following is your standing self-model (bansai), as of this morning.",
    "bansai: your persistent memory is initializing in the background.",
  ];

  test("every FOREIGN_MARKER shape is tagged `foreign`, and `enters()` refuses it", () => {
    for (const text of FOREIGN) {
      expect({ text, source: classifyBlock(text) }).toEqual({ text, source: "foreign" });
      expect(enters({ role: "user", text, source: "foreign" })).toBe(false);
    }
    // The recognizers are ONE constant the preflight canary can reuse, and each
    // entry earns its place: every marker matches at least one shape above.
    expect(FOREIGN_MARKERS.length).toBe(5);
    for (const marker of FOREIGN_MARKERS) {
      expect(FOREIGN.some((t) => marker.test(t.trimStart()))).toBe(true);
    }
  });

  test("foreign material reaches the reader as a turn and is dropped at capture, not here", () => {
    const raw = FOREIGN.map((text) => JSON.stringify({ message: { role: "user", content: text } }))
      .concat(JSON.stringify({ message: { role: "user", content: "What the user actually said." } }))
      .join("\n");
    const read = parseTranscript(raw);
    expect(read.turns.map((t) => t.source)).toEqual([
      ...FOREIGN.map(() => "foreign" as const),
      "conversation",
    ]);
    // Same rule, one place: `remember/`'s `enters()` is what drops it.
    const { a } = adapter();
    const result = a.stop(input({ turns: read.turns }));
    expect(result.spansAppended).toBe(1);
    expect(a.counterpart.spans.spans("proj").map((s) => s.text)).toEqual([
      "What the user actually said.",
    ]);
  });

  test("a `<system-reminder>` is still `injected`, and injected still ENTERS", () => {
    const text = "<system-reminder>the host's own note</system-reminder>";
    expect(classifyBlock(text)).toBe("injected");
    expect(enters({ role: "user", text, source: "injected" })).toBe(true);
  });

  test("a Stop-hook wrapper WITHOUT a foreign marker is not foreign — v2's own asks arrive that way", () => {
    const ours = `Stop hook feedback:\n- ${AUTHORSHIP_ASK}`;
    expect(classifyBlock(ours)).not.toBe("foreign");
    expect(enters({ role: "user", text: ours, source: classifyBlock(ours) })).toBe(true);
    // A bansai marker that is not at the start of the block is not a wrapper
    // match either — only the containment marker crosses a block boundary.
    expect(classifyBlock("we should ask whether [bansai] still runs here")).toBe("conversation");
  });

  test("ordinary conversation is untouched by the new rule", () => {
    expect(classifyBlock("We settled the storage split today.")).toBe("conversation");
    expect(classifyBlock("")).toBe("conversation");
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

// ═══════════════════════════════════════════════════════════════════════════
// The embed client — batched, isolated per chunk, and refusing BY NAME
//
// NO TEST HERE MAKES A NETWORK CALL. Every one supplies its own `fetch`, and
// the tests about a MISSING credential assert the fake was never reached — "it
// failed" is not the property; "it refused before the socket" is.
// ═══════════════════════════════════════════════════════════════════════════

/** A deterministic stand-in for a real vector: same text ⇒ same vector, always. */
function vectorFor(text: string): number[] {
  const v = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < text.length; i += 1) {
    const at = i % 8;
    v[at] = ((v[at] as number) + text.charCodeAt(i)) % 97;
  }
  const norm = Math.sqrt(v.reduce((s, n) => s + n * n, 0)) || 1;
  return v.map((n) => n / norm);
}

interface VoyageCall {
  url: string;
  init: RequestInit;
  body: { model?: string; input?: string[] };
}

/**
 * A fake Voyage endpoint. `poison` names a text whose CHUNK the far end rejects
 * — the E1 scenario: one bad item, and the question is what becomes of its
 * siblings.
 */
function voyageFetch(
  opts: { poison?: string; short?: boolean; garbage?: boolean; status?: number } = {},
): { calls: VoyageCall[]; fetch: FetchLike } {
  const calls: VoyageCall[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init.body)) as { model?: string; input?: string[] };
      calls.push({ url, init, body });
      const input = body.input ?? [];
      if (opts.poison !== undefined && input.includes(opts.poison)) {
        return new Response("bad input", { status: opts.status ?? 400 });
      }
      if (opts.garbage === true) return new Response(JSON.stringify({ nope: true }), { status: 200 });
      const data = input.map((t) => ({ embedding: vectorFor(t) }));
      if (opts.short === true) data.pop();
      return new Response(JSON.stringify({ data }), { status: 200 });
    },
  };
}

describe("embed-client — the request, the batches, and every refusal by name", () => {
  test("the request carries the pinned model and the key as a HEADER, never a query", async () => {
    const { calls, fetch } = voyageFetch();
    const client = embedClient({ config: config(), fetch });
    const batch = await client(["a memory about cold brew", "a memory about the dashboard"]);

    expect(batch.requested).toBe(2);
    expect(batch.returned).toBe(2);
    expect(batch.chunks).toBe(1);
    expect(batch.failures).toEqual([]);
    expect(batch.model).toBe(DEFAULT_EMBED_MODEL);
    expect(batch.vectors[0]).toEqual(vectorFor("a memory about cold brew"));

    const call = calls[0] as VoyageCall;
    expect(call.url).toBe(VOYAGE_ENDPOINT);
    expect(call.body.model).toBe(DEFAULT_EMBED_MODEL);
    expect(call.body.input).toEqual(["a memory about cold brew", "a memory about the dashboard"]);
    // The credential is a header. A URL is logged by every proxy on the way.
    const headers = call.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer pa-test-not-a-real-key");
    expect(call.url).not.toContain("pa-test-not-a-real-key");
  });

  test("large input is CHUNKED, and one poisoned item fails only its own chunk (scar E1)", async () => {
    const texts = Array.from({ length: 6 }, (_, i) => `memory number ${i}`);
    const { calls, fetch } = voyageFetch({ poison: "memory number 3", status: 400 });
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const client = embedClient({
      config: config(),
      fetch,
      batchSize: 2,
      onEvent: (name, data) => events.push({ name, data }),
    });
    const batch = await client(texts);

    expect(batch.chunks).toBe(3);
    expect(calls.length).toBe(3);
    // The poisoned chunk's slots are NULL; every sibling's vector stands.
    expect(batch.vectors[0]).toEqual(vectorFor("memory number 0"));
    expect(batch.vectors[1]).toEqual(vectorFor("memory number 1"));
    expect(batch.vectors[2]).toBe(null);
    expect(batch.vectors[3]).toBe(null);
    expect(batch.vectors[4]).toEqual(vectorFor("memory number 4"));
    expect(batch.vectors[5]).toEqual(vectorFor("memory number 5"));
    expect(batch.returned).toBe(4);
    // And the failure NAMES itself — which chunk, where it started, and why.
    expect(batch.failures).toEqual([
      { chunk: 1, from: 2, count: 2, code: "HTTP_ERROR", status: 400 },
    ]);
    expect(events.filter((e) => e.name === "embed.chunk.failed").length).toBe(1);
    // Telemetry is content-by-reference: no embedded text in any payload.
    expect(JSON.stringify(events)).not.toContain("memory number");
  });

  test("a SHORT response is a failure, not data — vectors are never misaligned", async () => {
    const { fetch } = voyageFetch({ short: true });
    const client = embedClient({ config: config(), fetch });
    const batch = await client(["one", "two", "three"]);
    expect(batch.vectors).toEqual([null, null, null]);
    expect(batch.failures[0]?.code).toBe("WRONG_VECTOR_COUNT");
  });

  test("a body with no embeddings in it refuses by name rather than inventing vectors", async () => {
    const { fetch } = voyageFetch({ garbage: true });
    const client = embedClient({ config: config(), fetch });
    const batch = await client(["one"]);
    expect(batch.vectors).toEqual([null]);
    expect(batch.failures[0]?.code).toBe("BAD_RESPONSE");
  });

  test("a MISSING key refuses with the right reason, before any socket opens", async () => {
    delete process.env[EMBED_KEY_ENV];
    let called = false;
    const client = embedClient({
      config: config(),
      fetch: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    await expect(client(["anything"])).rejects.toThrow(EmbedError);
    // THE REASON, not merely the failure — and the socket was never reached.
    expect(called).toBe(false);
    try {
      await client(["anything"]);
      throw new Error("did not refuse");
    } catch (err) {
      expect((err as EmbedError).code).toBe("NO_API_KEY");
      expect((err as EmbedError).detail["env"]).toBe(EMBED_KEY_ENV);
    }
  });

  test("an EXPIRED placeholder seat refuses too — a vector's generation is its identity", async () => {
    let called = false;
    const client = embedClient({
      config: config({
        models: { embed: { id: "voyage-next", placeholder: true, expires: "2026-01-01" } },
      }),
      today: "2026-06-01",
      fetch: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    try {
      await client(["anything"]);
      throw new Error("did not refuse");
    } catch (err) {
      expect((err as EmbedError).code).toBe("SEAT_UNUSABLE");
      expect((err as EmbedError).detail["status"]).toBe("expired");
    }
    expect(called).toBe(false);
  });

  test("the key comes from the ENVIRONMENT only — never from a file (scar §2.18)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/adapters/claude-code/embed-client.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    expect(/readFileSync|readFile\(|existsSync/.test(code)).toBe(false);
    expect(code).toContain("process.env[EMBED_KEY_ENV]");
  });

  test("the injected signal reaches the socket, and an abort stops the run BY NAME", async () => {
    const controller = new AbortController();
    const { calls, fetch } = voyageFetch();
    const client = embedClient({ config: config(), fetch, signal: controller.signal });
    await client(["one"]);
    // The caller's abort is the caller's: it is handed to fetch, not re-invented.
    expect((calls[0] as VoyageCall).init.signal).toBe(controller.signal);

    controller.abort();
    const after = await client(["two", "three"]);
    expect(calls.length).toBe(1); // no second socket was opened
    expect(after.vectors).toEqual([null, null]);
    expect(after.failures).toEqual([{ chunk: 0, from: 0, count: 2, code: "ABORTED" }]);
  });

  test("a fetch that REJECTS mid-run is isolated, and its siblings still land", async () => {
    let n = 0;
    const client = embedClient({
      config: config(),
      batchSize: 1,
      fetch: async (_url, init) => {
        n += 1;
        if (n === 1) throw new Error("socket died");
        const body = JSON.parse(String(init.body)) as { input: string[] };
        return new Response(
          JSON.stringify({ data: body.input.map((t) => ({ embedding: vectorFor(t) })) }),
          { status: 200 },
        );
      },
    });
    const batch = await client(["first", "second"]);
    expect(batch.vectors[0]).toBe(null);
    expect(batch.vectors[1]).toEqual(vectorFor("second"));
    expect(batch.failures[0]?.code).toBe("BAD_RESPONSE");
  });
});

describe("the live embedder — a sync face over an async client, and an honest miss", () => {
  test("the sync face never opens a socket: it MISSES until the live half fills it", async () => {
    const { calls, fetch } = voyageFetch();
    const events: string[] = [];
    const live = createEmbedder({ config: config(), fetch, onEvent: (name) => events.push(name) });

    // Before anything was fetched, the store's socket gets null — never `[]`,
    // which would be a dim-0 row every cosine reads as 0.0 similarity.
    expect(live.embed("cold brew, never iced")).toBe(null);
    expect(calls.length).toBe(0);
    expect(events).toContain("embed.cache.miss");
    expect(live.stats().misses).toBe(1);

    const got = await live.vector("cold brew, never iced");
    expect(got).toEqual(vectorFor("cold brew, never iced"));
    // Now the SAME text answers synchronously — this is what puts a vector in
    // box 3 at put time for a memory the async door already paid for.
    expect(live.embed("cold brew, never iced")).toEqual(vectorFor("cold brew, never iced"));
    expect(live.stats().hits).toBe(1);
    expect(calls.length).toBe(1);

    // And a repeat costs nothing: the cache answers before the client is asked.
    await live.vector("cold brew, never iced");
    expect(calls.length).toBe(1);
  });

  test("`warm` fetches a whole batch at once, and a poisoned chunk costs only itself", async () => {
    const texts = ["alpha thought", "beta thought", "gamma thought", "delta thought"];
    const { calls, fetch } = voyageFetch({ poison: "gamma thought" });
    const live = createEmbedder({ config: config(), fetch, batchSize: 2 });
    const landed = await live.warm(texts);

    expect(calls.length).toBe(2);
    expect(landed).toBe(2);
    expect(live.embed("alpha thought")).toEqual(vectorFor("alpha thought"));
    expect(live.embed("gamma thought")).toBe(null);
    expect(live.stats().failed).toBe(2);
  });

  test("a missing credential is LOUD in telemetry and NULL to the caller — never a throw", async () => {
    delete process.env[EMBED_KEY_ENV];
    const events: { name: string; data: Record<string, unknown> }[] = [];
    const { calls, fetch } = voyageFetch();
    const live = createEmbedder({
      config: config(),
      fetch,
      onEvent: (name, data) => events.push({ name, data }),
    });
    // An embedder that cannot embed must never fail a deposit: box 3 is
    // rebuildable, a memory is not.
    expect(await live.vector("something worth keeping")).toBe(null);
    expect(calls.length).toBe(0);
    const refused = events.filter((e) => e.name === "embed.refused");
    expect(refused.length).toBe(1);
    expect(refused[0]?.data["code"]).toBe("NO_API_KEY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The wiring: the store's socket, the egress knob, and novelty stops being null
// ═══════════════════════════════════════════════════════════════════════════
describe("the embedder reaches the store — indexed at put, recomputed at rebuild", () => {
  /** A sync fake in the shape the store's socket takes. No network anywhere. */
  const fake = (text: string): number[] => vectorFor(text);

  test("a fake Embedder through Counterpart.open indexes at PUT and again at REBUILD", () => {
    const c = Counterpart.open({ dir, embed: fake });
    open.push(c);
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Cold brew every morning, never iced coffee",
    });

    // Indexed AT PUT: the vector is in box 3 and answers a vector query.
    const cue = fake(indexTextOf(null, "Cold brew every morning, never iced coffee"));
    expect(c.store.nearestTo(cue, 3)[0]?.id).toBe(id);
    // And it is the context slice a novelty measurement is error against.
    expect(c.store.neighbourVectors(cue, 3).length).toBe(1);

    // Recomputed AT REBUILD: nothing is declared un-recomputed.
    const report = c.store.rebuildCache();
    expect(report.indexed).toBe(1);
    expect(report.unrecomputed).toBe(0);
    expect(report.declared).toEqual([]);
    expect(c.store.nearestTo(cue, 3)[0]?.id).toBe(id);
  });

  test("an embedder that MISSES is counted and declared — never a dim-0 row", () => {
    // The production shape: a cache-backed sync face with nothing warm in it.
    const c = Counterpart.open({ dir, embed: () => null });
    open.push(c);
    c.store.put({ type: "memory", kind: "fact", body: "a memory nobody embedded" });

    const report = c.store.rebuildCache();
    expect(report.indexed).toBe(1);
    expect(report.unrecomputed).toBe(1);
    expect(report.declared[0]?.what).toBe("embeddings");
    // Nothing was written to the vector table, so nothing lies about similarity.
    expect(c.store.neighbourVectors([1, 0, 0], 5)).toEqual([]);
    // The lexical index is untouched by any of this — box 3's other half works.
    expect(c.store.search("embedded")[0]).toBeDefined();
  });
});

describe("the egress knob — off by default, and honoured by both composition roots", () => {
  test("without the knob NO client exists, even with a key in the environment", async () => {
    expect(openEmbedder(config())).toBe(null);
    expect(openEmbedder(config({ embedder: { enabled: false } }))).toBe(null);
    // Switched on, but the session is an INSTRUMENT: an instrument opens no
    // sockets (docs/observer-mode.md, scar E7).
    expect(openEmbedder(config({ embedder: { enabled: true }, observer: true }))).toBe(null);
    expect(openEmbedder(config({ embedder: { enabled: true } }))).not.toBe(null);

    // And the whole adapter path: a deposit with the knob off touches no socket.
    const { a } = adapter();
    const out = await a.counterpart.submitSessionEnd(
      { content: "A deposit made with the embedder switched off, which must reach no network.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    // Nothing was embedded, so novelty stays null WITH ITS REASON — the record
    // that says "no vector reached this seam", not a defaulted number.
    expect(a.counterpart.store.physicsOf(out.memoryId as string).salience.novelty).toBe(null);
  });

  test("the config knob parses like every other, and a half-written one stands down", () => {
    const loaded = loadConfig({
      embedder: { enabled: true },
      models: { embed: { id: "voyage-3-large" }, interpret: { id: "claude-opus-5" } },
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.config.embedder).toEqual({ enabled: true });
    expect(loaded.config.models?.embed).toEqual({ id: "voyage-3-large" });
    expect(loaded.config.models?.interpret).toEqual({ id: "claude-opus-5" });

    // An unreadable egress knob fails toward STANDING DOWN, never toward "on".
    const bad = loadConfig({ embedder: { enabled: "yes" } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unreadable");
    expect(bad.config).toEqual({ observer: true });
    expect(loadConfig({ models: { embed: { id: 7 } } }).config).toEqual({ observer: true });

    // The seat has its own pinned default and its own expiry rules.
    expect(seatStatus("embed", undefined, "2026-06-01", DEFAULT_EMBED_MODEL)).toEqual({
      seat: "embed",
      id: DEFAULT_EMBED_MODEL,
      status: "pinned",
      usable: true,
    });
  });
});

describe("novelty stops being null — the authored door measures prediction error", () => {
  test("the FIRST deposit is blind for lack of CONTEXT, not for lack of a vector", async () => {
    const { fetch, calls } = voyageFetch();
    const { spawner } = fakeSpawner();
    const a = openAdapter(config({ embedder: { enabled: true } }), {
      command: "/bin/true",
      args: ["runner"],
      spawner,
      embedFetch: fetch,
    });
    open.push(a.counterpart);

    const first = await a.counterpart.submitSessionEnd(
      {
        content: "The rebuildable cache is deliberately left out of the backup set, because its loss is a re-index.",
        kind: "fact",
      },
      { session: "s1", scope: "proj" },
    );
    expect(first.deposited).toBe(true);
    // A vector WAS fetched — the door is live, not decorative.
    expect(calls.length).toBe(1);
    // Box 3 held nothing to be surprised against, so novelty is null. That is a
    // DIFFERENT record from "no vector reached the seam", and the difference is
    // the whole reason `NoveltyReason` is a vocabulary rather than a boolean.
    const store = a.counterpart.store;
    expect(store.physicsOf(first.memoryId as string).salience.novelty).toBe(null);
    // The vector the gate paid for is the vector box 3 indexed: ONE call, both
    // jobs — which is what makes the second deposit measurable.
    expect(store.neighbourVectors(vectorFor("x"), 5).length).toBe(1);

    const second = await a.counterpart.submitSessionEnd(
      {
        content: "Backups cover canonical prose and the operational database, and skip the cache on purpose.",
        kind: "fact",
      },
      { session: "s1", scope: "proj" },
    );
    expect(second.deposited).toBe(true);
    // AND HERE IT IS: a computed number, on a real memory, from a real vector.
    const novelty = store.physicsOf(second.memoryId as string).salience.novelty;
    expect(typeof novelty).toBe("number");
    expect(novelty).toBeGreaterThanOrEqual(0);
    expect(novelty).toBeLessThanOrEqual(1);
    expect(calls.length).toBe(2);
  });

  test("the DETACHED WORKER embeds too — the root that mints is the root that must", async () => {
    const { a } = adapter();
    a.stop(input());
    a.counterpart.close();
    open.length = 0;

    const embedded: string[][] = [];
    const report = await runOnce({
      config: config({ embedder: { enabled: true } }),
      today: "2026-01-02",
      date: "2026-01-02",
      // ONE fake for the whole worker; it answers by endpoint, which is how a
      // test proves the two clients are two clients.
      fetch: async (url: string, init: RequestInit): Promise<Response> => {
        if (url === VOYAGE_ENDPOINT) {
          const body = JSON.parse(String(init.body)) as { input: string[] };
          embedded.push(body.input);
          return new Response(
            JSON.stringify({ data: body.input.map((t) => ({ embedding: vectorFor(t) })) }),
            { status: 200 },
          );
        }
        return okResponse(
          streamed(
            '[{"content":"The cache is rebuildable from canonical files, which is why it never enters the backup set.","kind":"fact"}]',
          ),
        );
      },
    });
    expect(report.minted).toBe(1);
    // ONE batched call for the chunk's mints — not one round trip per proposal.
    expect(embedded.length).toBe(1);
    expect(embedded[0]?.length).toBe(1);

    // And the vector landed in box 3, on the path that mints most memories.
    const next = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(next.counterpart);
    expect(next.counterpart.store.neighbourVectors(vectorFor("anything"), 5).length).toBe(1);
  });

  test("a deposit whose embedding FAILS still lands — blind, and countably so", async () => {
    const { spawner } = fakeSpawner();
    const a = openAdapter(config({ embedder: { enabled: true } }), {
      command: "/bin/true",
      args: ["runner"],
      spawner,
      embedFetch: async () => new Response("upstream is down", { status: 503 }),
    });
    open.push(a.counterpart);

    const out = await a.counterpart.submitSessionEnd(
      { content: "A memory made while the embedding provider was returning 503s all afternoon.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    // The memory is not lost to a failing side service (box 3 is rebuildable, a
    // memory is not), and the failure is named in telemetry.
    expect(out.deposited).toBe(true);
    expect(a.counterpart.store.physicsOf(out.memoryId as string).salience.novelty).toBe(null);
  });

  /**
   * THE TRIPWIRE FOR A WHOLE CLASS OF BUG, and it is worth saying what class.
   *
   * The first version of `batteryGate` embedded the author's RAW draft and gated
   * it afterwards, so a credential in a session-end dump reached the embedding
   * provider verbatim while the prose written to disk was correctly redacted.
   * Every existing secrets test passed throughout: they all assert what is
   * DURABLE, and this leak was on the wire, which no test looked at.
   *
   * So this test does not check the store. It records what the embedder was
   * ACTUALLY HANDED and asserts the gate ran first — which is the only thing
   * that makes "the secrets battery is not ablatable" true of egress too.
   */
  test("the embedder is handed the GATED text — a credential never reaches the wire", async () => {
    const CREDENTIAL = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    const seen: string[] = [];
    const c = Counterpart.open({
      dir,
      embed: (t: string) => vectorFor(t),
      vectors: {
        vector: async (text: string) => {
          seen.push(text);
          return vectorFor(text);
        },
        warm: async (texts: readonly string[]) => {
          seen.push(...texts);
          return texts.length;
        },
      },
    });
    open.push(c);

    const out = await c.submitSessionEnd(
      {
        content: `The deploy job authenticates with the key ${CREDENTIAL} which I pasted into the config by mistake.`,
        kind: "fact",
      },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);

    // The embedder WAS called — this test can fail by omission otherwise.
    expect(seen.length).toBeGreaterThan(0);
    // And what it got had already been through the battery.
    for (const text of seen) {
      expect(text).toContain("[REDACTED:");
      expect(text).not.toContain(CREDENTIAL);
    }
    // The stored prose agrees, as it always did — the point is that the wire
    // now agrees WITH it rather than differing from it.
    expect(c.store.readProse(out.memoryId as string).body).not.toContain(CREDENTIAL);
  });

  test("a gate REWRITE keeps its vector: cache and lookup key on the same gated text", async () => {
    const CREDENTIAL = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    // A real client's cache, so the sync face and the live half are the same
    // object the production wiring uses — not two fakes agreeing with each other.
    const { fetch } = voyageFetch();
    const live = createEmbedder({ config: config(), fetch });
    const c = Counterpart.open({ dir, embed: live.embed, vectors: live });
    open.push(c);

    // Content the gate REWRITES. Before the reorder, the deposit paid for a
    // vector keyed on the raw draft and `indexOne` then looked up the redacted
    // text, missed, and stored no vector at all.
    const out = await c.submitSessionEnd(
      { content: `Rotated ${CREDENTIAL} out of the deploy config this afternoon.`, kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(out.deposited).toBe(true);
    const body = c.store.readProse(out.memoryId as string).body;
    expect(body).toContain("[REDACTED:");

    // THE VECTOR SURVIVED THE REWRITE: box 3 holds a row for this memory, and
    // the sync face hits on the exact string the store indexes.
    expect(live.embed(indexTextOf(null, body))).not.toBe(null);
    expect(live.stats().misses).toBe(0);
    expect(c.store.neighbourVectors(vectorFor(indexTextOf(null, body)), 5).length).toBe(1);
    expect(c.store.nearestTo(vectorFor(indexTextOf(null, body)), 1)[0]?.id).toBe(
      out.memoryId as string,
    );
  });

  test("an OBSERVER opens no socket at all — the stand-down is structural", async () => {
    const { fetch, calls } = voyageFetch();
    // An observer refuses to open a store that does not exist yet, so the dir is
    // initialized by an ordinary session first — as it would be in life.
    Counterpart.open({ dir }).close();

    const c = Counterpart.open({
      dir,
      observer: true,
      embed: (t: string) => vectorFor(t),
      vectors: createEmbedder({ config: config(), fetch }),
    });
    open.push(c);
    await c.submitSessionEnd(
      { content: "An instrument's deposit, which deposits nothing and embeds nothing.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(calls.length).toBe(0);
  });
});
