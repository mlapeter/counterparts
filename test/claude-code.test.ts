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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_EVENT,
  Counterpart,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  SWEEP_GATE_EVENT,
} from "../src/core/counterpart.js";
import { indexTextOf } from "../src/core/store/index.js";
import { canonicalScope, isLive, readSession } from "../src/adapters/sessions.js";
import type { SessionRecord } from "../src/adapters/sessions.js";
import { OK_STOP_REASONS, TUNABLES as REMEMBER, enters, validateWatchdog } from "../src/core/remember/index.js";
import { BOOTSTRAP, BRIEFING_KEY } from "../src/core/self/index.js";
import {
  AB_DIR_ENV,
  API_KEY_ENV,
  stopAsk,
  CREDENTIAL_FILE_EVENT,
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
  attributePeers,
  capabilities,
  classifyBlock,
  createEmbedder,
  embedClient,
  extractJson,
  interpretClient,
  loadConfig,
  loadCredentials,
  openAdapter,
  openEmbedder,
  parseTranscript,
  permissionWarning,
  SCOPE_ENV,
  SESSION_ENV,
  backfillVectors,
  lagText,
  laggedSemantic,
  LAG_PROMPT_BYTES,
  LAG_REPLY_BYTES,
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
import { hostConfig, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import { runOnce, runnerConfig } from "../src/adapters/claude-code/bin/runner.js";

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

/**
 * THE CRASH, simulated the only way this host can produce one: the session hit a
 * boundary and nobody ever came back. The worker's sweep reads a transcript only
 * for a session with uncovered spans, no `session-end` boundary, and silence past
 * `CRASH_STALE_MS` (`remember/spans.ts#crashedSessions`), so a test that wants the
 * sweep to fire has to age the durable boundary record rather than delete a gate.
 */
function goQuiet(ms: number = REMEMBER.CRASH_STALE_MS + 60_000): void {
  const root = join(dir, "spans");
  for (const key of readdirSync(root, { withFileTypes: true })) {
    if (!key.isDirectory()) continue;
    const file = join(root, key.name, "boundaries.jsonl");
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const aged = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((line) => {
        const record = JSON.parse(line) as { at: number };
        return JSON.stringify({ ...record, at: record.at - ms });
      });
    writeFileSync(file, `${aged.join("\n")}\n`, "utf8");
  }
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

/**
 * Enough substance for the FIRST ask. The old authorship ask fired on the first
 * Stop of any session that had anything uncovered; the one pacer is the
 * chapter's, so a Stop now has to have earned it — real turns AND real bytes.
 */
const BIG_TURNS: HookInput["turns"] = Array.from({ length: 14 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `Turn ${i}: ${"a real exchange with enough substance in it to pace a ritual honestly, said at the length people actually work at, which is what the byte half of the threshold is measuring rather than the turn half. ".repeat(2)}`,
}));

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

  /**
   * The delivery preface: the wake is composed at a boundary and served
   * unchanged to every session until the next one, so the line that says WHICH
   * SYSTEM, which lived day, today's date and how big the store is has to be
   * composed here, at injection. On 2026-09-03 the system under this host
   * changed mid-day and the body went on speaking as the old one.
   */
  test("the injection carries the delivery preface — composed at the hook, counted, inside the ceiling", async () => {
    const { a } = adapter();
    for (let i = 0; i < 6; i += 1) {
      a.counterpart.store.put({
        type: "memory",
        kind: "self",
        band: "identity",
        body: `Something true about how I work, number ${i}, in enough words to spend bytes on.`,
        salience: { novelty: null, relevance: 0.9, emotional: 0.6, predictive: 0.7 },
        physics: { birthDay: 0, lastUsedDay: 0, promotedIdentity: true },
      });
    }
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });

    const result = a.sessionStart(input());
    const lines = result.injection.split("\n");
    expect(lines[0] ?? "").toContain("<!-- counterparts:wake ");
    expect(lines[1] ?? "").toContain("Counterparts memory, day ");
    expect(lines[1] ?? "").toContain("2026-01-02");
    expect(lines[1] ?? "").toContain(" memories ");

    // Counted: the hook's bytes, the sentinel's bytes and the text agree, and
    // the whole thing still fits what the host said it can carry.
    expect(result.bytes).toBe(Buffer.byteLength(result.injection, "utf8"));
    expect(result.sentinel).toContain(`bytes=${result.bytes}`);
    expect(lines[lines.length - 1] ?? "").toBe(result.sentinel as string);
    expect(result.bytes).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(a.events("adapter.injection.overbudget").length).toBe(0);
    expect(a.events("adapter.wake.injected")[0]?.data?.preface).toBe(true);

    // Composed at DELIVERY: the published row carries no preface at all.
    expect(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "").not.toContain("Counterparts memory, day ");

    // And the delivered loop still closes, on the sentinel actually shipped.
    a.userPromptSubmit(input({ prompt: "hello", sentinelSeen: result.sentinel }));
    const delivered = a.events("adapter.wake.delivered");
    expect(delivered[delivered.length - 1]?.data?.delivered).toBe(true);
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
    expect(a.counterpart.self.episodeState("s1").asks).toBeGreaterThan(0);
    // A second stop on the same substance is not due again.
    const second = a.stop(input({ turns: bigTurns() }));
    expect(second.ask).toBe(null);
  });

  test("ONE ask, not two: one text, one row, and it names both tools and the session", () => {
    // §13 G3 in v1's words — "the blocked moment carries a single ask; new
    // features do not get to grow it back into two". v2 grew it back into two
    // anyway (an authorship pacer beside the chapter pacer) and drew about a
    // dozen asks in a 13-turn evening, 2026-09-04.
    const { a } = adapter();
    const first = a.stop(input({ turns: BIG_TURNS }));
    expect(first.ask).toBe(stopAsk("s1", 1));
    expect(first.ask).toContain("session_end");
    expect(first.ask).toContain("chapter tool");
    expect(first.ask).toContain("s1");
    // ONE durable row for the moment, carrying the outcome the daily counts.
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect(rows[0]?.["outcome"]).toBe("asked");
    expect(rows[0]?.["chapter"]).toBe(1);
    // The coverage read still happens — as a RECORD, not as a second gate.
    expect(rows[0]?.["uncovered"]).toBeGreaterThan(0);
    expect(typeof rows[0]?.["unaskableBytes"]).toBe("number");
    // And the retired names are not written any more.
    expect(a.events("adapter.authorship.ask")).toEqual([]);
    expect(a.events("adapter.episode.ask")).toEqual([]);
  });

  test("the re-fired Stop asks nothing AND advances nothing — not even the pacing", () => {
    const { a } = adapter();
    expect(a.stop(input({ turns: BIG_TURNS })).ask).not.toBe(null);
    const asked = a.counterpart.self.episodeState("s1").asks;
    // The host re-fires the blocked Stop with `stop_hook_active`. It must not
    // spend a pacing slot or a day-cap slot on a moment nobody will read.
    const refire = a.stop(input({ reFired: true, turns: bigTurns() }));
    expect(refire.ask).toBe(null);
    expect(refire.ok).toBe(true);
    expect(a.counterpart.self.episodeState("s1").asks).toBe(asked);
    expect(a.counterpart.store.eventLog({ name: "adapter.ask", limit: 100 }).length).toBe(1);
    // The boundary still happened: the re-fire is silent, never idle (§13 G5).
    expect(a.events("adapter.boundary").length).toBe(2);
  });

  test("stop raises the ask while the experiencer still has the pen, and MEASURES the tail", () => {
    const { a } = adapter();
    const first = a.stop(input({ turns: BIG_TURNS }));
    expect(first.ask).toBe(stopAsk("s1", 1));
    const measured = a.events("adapter.ask")[0]?.data;
    expect(measured?.uncovered).toBeGreaterThan(0);
    // The unaskable tail is MEASURED at the same moment, not assumed (§2 G12).
    expect(typeof measured?.unaskableBytes).toBe("number");
  });

  test("the ask is fail-open, and coverage is a RECORD rather than a second gate", () => {
    const { a } = adapter();
    a.counterpart.captureSpans({ session: "s1", scope: "proj", turns: TURNS });
    rmSync(join(dir, "spans"), { recursive: true, force: true });
    Bun.write(join(dir, "spans"), "not a directory");
    const result = a.stop(input({ sessionId: "fail-open", turns: BIG_TURNS }));
    // The boundary still returns cleanly, and the ask still goes out: the
    // coverage read measures the tail (§2 G12) and no longer decides anything.
    // A second condition on a single ask is what the two-pacer Stop was.
    expect(result.ok).toBe(true);
    expect(result.ask).toBe(stopAsk("fail-open", 1));
    const row = a.events("adapter.ask")[0]?.data;
    expect(row?.outcome).toBe("asked");
    expect(typeof row?.uncovered === "number" || row?.uncovered === null).toBe(true);
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
    return BIG_TURNS;
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
  test("every session-ending path CAPTURES, and the worker's sweep reads none of it until a session crashes", async () => {
    // The ruling, end to end (2026-09-04): boundaries still capture at Stop,
    // SessionEnd and pre-compaction — that capture is the compaction-amnesia
    // backstop — and the worker still spawns for the flush and the cycle. What
    // changed is that its SWEEP selects nothing unless a session crashed.
    const { a, calls } = adapter();
    const turnsFor = (tag: string): HookInput["turns"] => [
      { role: "user", text: `A ${tag} conversation about how the backup set stays small enough to be honest about.` },
      { role: "assistant", text: `Noted, in the ${tag} session: the cache is rebuildable, so nothing backs it up.` },
    ];
    for (const hook of SESSION_ENDING) {
      const result = a.hook(hook as HookName, input({ sessionId: `s-${hook}`, turns: turnsFor(hook) }));
      expect({ hook, ok: result.ok, appended: result.spansAppended > 0 }).toEqual({ hook, ok: true, appended: true });
    }
    // Stop and SessionEnd spawn the worker; that is unchanged and load-bearing.
    expect(calls.length).toBe(2);
    a.counterpart.close();
    open.length = 0;

    // The worker runs, and the interpreter is a tripwire: any model call fails
    // this test. Nothing has crashed — every session's last boundary is seconds old.
    const quiet = await runOnce({
      config: config(),
      today: "2026-01-02",
      date: "2026-01-02",
      fetch: async () => {
        throw new Error("the sweep made a model call with nothing crashed");
      },
    });
    expect({ ran: quiet.ran, swept: quiet.swept, minted: quiet.minted }).toEqual({
      ran: true,
      swept: 0,
      minted: 0,
    });

    // Now the two sessions that never reached `session-end` go quiet. THOSE are
    // crashed; the one that ended normally is not, and is not read.
    goQuiet();
    const swept = await runOnce({
      config: config(),
      today: "2026-01-03",
      date: "2026-01-03",
      fetch: async () =>
        okResponse(
          streamed('[{"content":"The cache is rebuildable from canonical files, which is why it never enters the backup set.","kind":"fact"}]'),
        ),
    });
    expect(swept.swept).toBeGreaterThan(0);

    // The gate's own durable row, both readings, so the daily can tell a quiet
    // sweep from a broken one.
    const after = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(after.counterpart);
    const rows = after.counterpart.store
      .eventLog({ name: SWEEP_GATE_EVENT, limit: 10 })
      .map((row) => JSON.parse(row.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(2);
    expect({ ran: rows[0]?.["ran"], skipped: rows[0]?.["skippedNotCrashed"] }).toEqual({ ran: 0, skipped: 1 });
    expect(rows[1]?.["ran"]).toBe(1);
    // Self-attributing: the row carries the calendar date the run belonged to,
    // so a reader does not have to infer it from the lived-day column.
    expect([rows[0]?.["date"], rows[1]?.["date"]]).toEqual(["2026-01-02", "2026-01-03"]);
  });

  test("a run sweeps the captured spans, mints, and publishes a briefing the next wake reads", async () => {
    const { a } = adapter();
    a.stop(input());
    a.counterpart.close();
    open.length = 0;
    goQuiet();

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
    // And the ask did not go out (G5).
    expect(result.ask).toBe(null);
    expect(a.events("adapter.ask")).toEqual([]);
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
        spansAppended: r.spansAppended,
        started: r.spawn?.started ?? null,
      });

      expect(pick(a.sessionStart(input()))).toEqual(pick(plain.sessionStart(input())));
      expect(pick(a.userPromptSubmit(input({ prompt: "what about storage?" })))).toEqual(
        pick(plain.userPromptSubmit(input({ prompt: "what about storage?" }))),
      );
      const parallelStop = a.stop(input({ turns: BIG_TURNS }));
      expect(pick(parallelStop)).toEqual(pick(plain.stop(input({ turns: BIG_TURNS }))));
      expect(parallelStop.ask).toBe(stopAsk("s1", 1));

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
    const stopped = a.stop(input({ turns: BIG_TURNS }));
    expect(a.events(PRIMACY_STANDDOWN_EVENT)).toEqual([]);
    expect(a.events(PRIMACY_DELIVER_EVENT)).toEqual([]);
    expect(stopped.ask).toBe(stopAsk("s1", 1));
    expect(a.counterpart.store.eventLog({ limit: 100 }).map((r) => r.name)).not.toContain(
      PRIMACY_STANDDOWN_EVENT,
    );
  });

  test("the DELIVERY is evidenced too: wake, recall, delivery-check and episode-ask rows are durable (G2/G4)", () => {
    // On any day v2 is the muted side — day 0, or a reverted day — a v2
    // delivery event IS the
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
    for (const name of ["adapter.wake.injected", "adapter.wake.delivered", "adapter.recall", "adapter.ask"]) {
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
    const DELIVERING = ["adapter.wake.injected", "adapter.recall", "adapter.ask"];
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

  test("a Stop-hook wrapper WITHOUT a foreign marker is `ritual`, not foreign — and enters nothing", () => {
    // The ask now carries the session id (`stopAsk`), which changes the
    // TEXT and not the classification: `ritual` is decided by the host's
    // wrapper, so the rule holds whatever the ask happens to say this turn.
    const ours = `Stop hook feedback:\n- ${stopAsk("s1", 1)}`;
    // Not foreign: another memory system did not write this, WE did. The
    // distinction is what keeps the canary's FOREIGN_MARKERS honest.
    expect(classifyBlock(ours)).not.toBe("foreign");
    expect(classifyBlock(ours)).toBe("ritual");
    // But it does not enter either: v2's own ask is not something that happened
    // to v2, and the ask's durable record is `adapter.ask`.
    expect(enters({ role: "user", text: ours, source: classifyBlock(ours) })).toBe(false);
    // A bansai marker that is not at the start of the block is not a wrapper
    // match either — only the containment marker crosses a block boundary.
    expect(classifyBlock("we should ask whether [bansai] still runs here")).toBe("conversation");
    // And the phrase MENTIONED mid-sentence is conversation about the mechanism.
    expect(classifyBlock("the host returns a Stop hook feedback: block here")).toBe("conversation");
  });

  test("ordinary conversation is untouched by the new rule", () => {
    expect(classifyBlock("We settled the storage split today.")).toBe("conversation");
    expect(classifyBlock("")).toBe("conversation");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Peer speakers and the system's own ritual text — the two host shapes that
// arrive user-role and are not the owner speaking (measured 2026-09-04)
// ═══════════════════════════════════════════════════════════════════════════
describe("the transcript reader attributes PEER messages and refuses its own RITUAL text", () => {
  /** The host's wrapper, with the attribute set the v2.1.260 bundle carries. */
  const wrapped = (
    body: string,
    attrs = 'from="uds:/tmp/cc-socks/30478.sock" from-name="peer-41" from-mode="prompting"',
  ) => `<cross-session-message ${attrs}>\n${body}\n</cross-session-message>`;

  const OWNER = "We settled the storage split today: prose on disk, one small database.";
  const PEER = "v2 challenge effect has no live consumer; session c781252f sweep census attached.";
  const RITUAL = `Stop hook feedback:\n- ${stopAsk("s1", 1)}`;
  const ASSISTANT = "Recorded — the cache being rebuildable is what keeps the backup honest.";

  /** The five host shapes as real JSONL lines, in the order a session sees them. */
  const FIXTURE = [
    JSON.stringify({ message: { role: "user", content: OWNER } }),
    JSON.stringify({ message: { role: "user", content: wrapped(PEER) } }),
    JSON.stringify({
      message: {
        role: "user",
        content: `Have a look at this and tell me if it holds:\n${wrapped(PEER)}`,
      },
    }),
    JSON.stringify({ message: { role: "user", content: RITUAL } }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: ASSISTANT }] } }),
  ].join("\n");

  const LABEL = "[message from another Claude session, peer-41]:";

  test("five host shapes, five turns, and the speaker of each is on the record", () => {
    const read = parseTranscript(FIXTURE);
    // ONE BLOCK STAYS ONE TURN. The per-session cursor indexes into this list,
    // so a reader that split a mixed block into two turns would re-slice a live
    // session's uncaptured tail on the day it shipped.
    expect(read.turns.length).toBe(5);
    expect(read.turns.map((t) => t.source)).toEqual([
      "conversation", // the owner, plainly
      "injected", // nothing but a peer message: kept, but nobody HERE spoke
      "conversation", // mixed: the owner did speak in this turn
      "ritual", // v2's own ask, handed back by the host
      "conversation", // the assistant
    ]);
    // The peer's words survive verbatim — they are real experience — but they
    // arrive wearing the speaker's name, never the owner's.
    expect(read.turns[1]?.text).toBe(`${LABEL} ${PEER}`);
    expect(read.turns[2]?.text).toBe(`Have a look at this and tell me if it holds:\n${LABEL} ${PEER}`);
    // The owner's own turn and the assistant's are untouched by any of this.
    expect(read.turns[0]?.text).toBe(OWNER);
    expect(read.turns[4]?.text).toBe(ASSISTANT);
  });

  test("the peer's words reach the span; the ritual text does not, and its exclusion is COUNTED", () => {
    const read = parseTranscript(FIXTURE);
    const { a } = adapter();
    const result = a.stop(input({ turns: read.turns }));
    expect(result.ok).toBe(true);

    const texts = a.counterpart.spans.spans("proj").map((s) => s.text);
    const conversation = texts.find((t) => t.includes(OWNER)) ?? "";
    // Kept: the peer's finding is in the buffer, and both times behind the label.
    expect(conversation).toContain(`${LABEL} ${PEER}`);
    // Refused: v2's ask never becomes a memory of v2 having thought it.
    for (const text of texts) {
      expect(text).not.toContain("Stop hook feedback:");
      expect(text).not.toContain("what did you LEARN here");
    }

    // SILENCE IS NOT HEALTH: the refusal is a number in the boundary record,
    // not an absence. One turn excluded — the ritual one.
    const boundary = a.events(BOUNDARY_EVENT).at(-1);
    expect(boundary?.data["excluded"]).toBe(1);
  });

  test("a peer message never PACES a ritual, and a mixed turn paces on the owner's half", () => {
    const read = parseTranscript(FIXTURE);
    // `substanceOf` counts `conversation` only: the pure peer turn and the
    // ritual turn are both out, the mixed turn is in (the owner did speak).
    expect(substanceOf(read.turns).turns).toBe(3);
    expect(substanceOf([read.turns[1]!]).turns).toBe(0);
    expect(substanceOf([read.turns[3]!]).turns).toBe(0);
  });

  test("attribution falls back through the host's attribute set, and never to the owner", () => {
    const named = (attrs: string) =>
      attributePeers(`<cross-session-message ${attrs}>hi</cross-session-message>`).text;
    expect(named('from-name="peer-41" from="uds:/tmp/cc-socks/1.sock"')).toBe(
      "[message from another Claude session, peer-41]: hi",
    );
    // No display name: the session id. An unattributed peer message is still
    // not the owner, so there is always a label.
    expect(named('from="uds:/tmp/cc-socks/1.sock" from-session="c781252f"')).toBe(
      "[message from another Claude session, c781252f]: hi",
    );
    // `from` is NOT a fallback: it is a machine-local socket path, and it must
    // not land in prose that outlives the socket. "unnamed" instead.
    expect(named('from="uds:/tmp/cc-socks/1.sock"')).toBe(
      "[message from another Claude session, unnamed]: hi",
    );
    expect(named('from="uds:/tmp/cc-socks/1.sock"')).not.toContain("cc-socks");
    expect(named("")).toBe("[message from another Claude session, unnamed]: hi");
    expect(named("from-name=''")).toBe("[message from another Claude session, unnamed]: hi");
    // Two peers in one block are two labels, in order.
    const two = attributePeers(
      `<cross-session-message from-name="a">one</cross-session-message>\n<cross-session-message from-name="b">two</cross-session-message>`,
    );
    expect(two.peers).toBe(2);
    expect(two.ownerText).toBe(false);
    expect(two.text).toBe(
      "[message from another Claude session, a]: one\n[message from another Claude session, b]: two",
    );
  });

  test("a TRUNCATED wrapper is left alone rather than swallowing the rest of the block", () => {
    // No closing tag: nothing is rewritten. The block still does not read as the
    // owner speaking, because the `cross-session-` catch-all tags it `injected`.
    const torn = '<cross-session-message from-name="peer-41">half a mess';
    expect(attributePeers(torn).peers).toBe(0);
    expect(classifyBlock(torn)).toBe("injected");
  });

  test("the idle notice is plain text, not a wrapper — and is still not the owner", () => {
    // Evidenced in the v2.1.260 bundle as a plain line, so it gets no rewrite;
    // `injected` is the honest reading: host bookkeeping about a peer.
    expect(classifyBlock('[Cross-session idle notice] "peer-41" is idle now')).toBe("injected");
    expect(classifyBlock('[Cross-session idle notice] "peer-41" has exited')).toBe("injected");
    // Any other wrapper the host adds under the same prefix reads the same way,
    // rather than being guessed at.
    expect(
      classifyBlock("<cross-session-whatever-comes-next>x</cross-session-whatever-comes-next>"),
    ).toBe("injected");
  });

  test("an ASSISTANT turn is never peer-rewritten — the host delivers peers user-role only", () => {
    const raw = JSON.stringify({
      message: { role: "assistant", content: [{ type: "text", text: `quoting ${wrapped("x")}` }] },
    });
    const read = parseTranscript(raw);
    expect(read.turns[0]?.text).toContain("<cross-session-message");
    expect(read.turns[0]?.source).toBe("injected");
  });

  test("v1's Stop-hook ask stays FOREIGN, not ritual — the canary's list still decides first", () => {
    const theirs = "Stop hook feedback:\n- [bansai] Before this session closes, what did you learn?";
    expect(classifyBlock(theirs)).toBe("foreign");
    expect(enters({ role: "user", text: theirs, source: classifyBlock(theirs) })).toBe(false);
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
    goQuiet();

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

// ═══════════════════════════════════════════════════════════════════════════
// The credential file — the ONE file the package's own config names
// ═══════════════════════════════════════════════════════════════════════════
/**
 * MEASURED, day 0 of the parallel run: this host's hook processes carry neither
 * `ANTHROPIC_API_KEY` nor `VOYAGE_API_KEY`, even with both exported in the
 * owner's `~/.zshrc` — a host's process environment is not the login shell's. So
 * every test here hands the loader a FRESH env object rather than the suite's
 * `process.env`: an empty object is the hook process as the host really starts
 * it, and a test that read the developer's own environment could not tell the
 * fix from the machine it ran on.
 */
describe("credentials — the environment first, then the ONE file the config names", () => {
  /**
   * The credentials file gets its OWN directory, never the data dir: the store
   * refuses an unclassified top-level entry (`store` §5 G11), so a credentials
   * file dropped beside the memory would fail the store open — which is also the
   * deployment note. Keep it outside `dataDir`.
   */
  let host: string;
  beforeEach(() => {
    host = mkdtempSync(join(tmpdir(), "counterparts-cred-"));
  });
  afterEach(() => {
    rmSync(host, { recursive: true, force: true });
  });

  /** A credentials file in that directory, removed with it. */
  function credFile(body: string, name = "creds.env"): string {
    const path = join(host, name);
    writeFileSync(path, body);
    chmodSync(path, 0o600);
    return path;
  }

  test("every shape a human writes parses; blank and # lines are not attempts", () => {
    // export, double quotes, single quotes, CRLF, a comment, a blank line.
    const path = credFile(
      [
        "# the two names this package documents",
        "",
        `export ${API_KEY_ENV}="sk-ant-from-the-file"`,
        `${EMBED_KEY_ENV}='pa-from-the-file'`,
        "",
      ].join("\r\n"),
    );
    const env: NodeJS.ProcessEnv = {};
    const load = loadCredentials(path, env);
    expect(load.reason).toBe("loaded");
    expect(load.loaded).toEqual([API_KEY_ENV, EMBED_KEY_ENV]);
    expect(load.ignoredLines).toBe(0);
    expect(env[API_KEY_ENV]).toBe("sk-ant-from-the-file");
    expect(env[EMBED_KEY_ENV]).toBe("pa-from-the-file");
  });

  test("THE ENVIRONMENT WINS: a name already answered is never overwritten", () => {
    const env: NodeJS.ProcessEnv = { [API_KEY_ENV]: "sk-ant-from-the-environment" };
    const load = loadCredentials(credFile(`${API_KEY_ENV}=sk-ant-from-the-file`), env);
    expect(env[API_KEY_ENV]).toBe("sk-ant-from-the-environment");
    expect(load.skippedPresent).toEqual([API_KEY_ENV]);
    expect(load.loaded).toEqual([]);
  });

  test("an EMPTY environment variable is a gap the file may fill", () => {
    // Every reader of these names tests `.trim().length`, so "exported but
    // empty" is absent everywhere else too — one definition of "present".
    const env: NodeJS.ProcessEnv = { [API_KEY_ENV]: "   " };
    const load = loadCredentials(credFile(`${API_KEY_ENV}=sk-ant-from-the-file`), env);
    expect(load.loaded).toEqual([API_KEY_ENV]);
    expect(env[API_KEY_ENV]).toBe("sk-ant-from-the-file");
  });

  test("ONLY the two documented names are honored — a third is ignored and COUNTED", () => {
    const env: NodeJS.ProcessEnv = {};
    const load = loadCredentials(
      credFile(
        [
          `${API_KEY_ENV}=sk-ant-yes`,
          "OPENAI_API_KEY=sk-not-ours",
          "PATH=/tmp/hijacked",
          "a line with no equals sign",
        ].join("\n"),
      ),
      env,
    );
    expect(load.loaded).toEqual([API_KEY_ENV]);
    expect(load.ignoredLines).toBe(3);
    // The bound, proven on the object: this is not a general env loader.
    expect(Object.keys(env)).toEqual([API_KEY_ENV]);
  });

  test("an empty value is not a credential, and the FIRST line for a name wins", () => {
    const env: NodeJS.ProcessEnv = {};
    const load = loadCredentials(
      credFile([`${EMBED_KEY_ENV}=`, `${API_KEY_ENV}=sk-first`, `${API_KEY_ENV}=sk-second`].join("\n")),
      env,
    );
    expect(load.loaded).toEqual([API_KEY_ENV]);
    expect(env[API_KEY_ENV]).toBe("sk-first");
    expect(env[EMBED_KEY_ENV]).toBeUndefined();
    expect(load.ignoredLines).toBe(2);
  });

  test("not-configured, absent and unreadable are three different records", () => {
    // No file named at all — the ordinary case for an owner who exports both.
    expect(loadCredentials(undefined, {}).reason).toBe("not-configured");
    expect(loadCredentials("   ", {}).reason).toBe("not-configured");
    // Named but not there.
    expect(loadCredentials(join(host, "nope.env"), {}).reason).toBe("absent");
    // Named and unreadable (a directory is not a credentials file).
    expect(loadCredentials(host, {}).reason).toBe("unreadable");
    // And none of them throws or writes anything.
    const env: NodeJS.ProcessEnv = {};
    loadCredentials(join(host, "nope.env"), env);
    expect(Object.keys(env)).toEqual([]);
  });

  test("a group/other-readable file is WARNED about by mode, never refused", () => {
    const path = credFile(`${API_KEY_ENV}=sk-ant-loose`, "loose.env");
    chmodSync(path, 0o644);
    const env: NodeJS.ProcessEnv = {};
    const load = loadCredentials(path, env);
    expect(load.mode).toBe("644");
    expect(load.permissive).toBe(true);
    // Warned — and the key is loaded anyway. The owner's machine, their call.
    expect(load.loaded).toEqual([API_KEY_ENV]);
    expect(permissionWarning(path, load)).toContain("mode 644");
    chmodSync(path, 0o600);
    const tight = loadCredentials(path, {});
    expect(tight.mode).toBe("600");
    expect(tight.permissive).toBe(false);
    expect(permissionWarning(path, tight)).toBeNull();
  });

  test("the capability row says WHICH SOURCE answered: env, file, or absent", () => {
    const fromEnv = capabilities({}, { [API_KEY_ENV]: "sk-ant-x" }).find((r) => r.name === "credential");
    expect({ reported: fromEnv?.reported, value: fromEnv?.value, detail: fromEnv?.detail }).toEqual({
      reported: true,
      value: true,
      detail: "env",
    });
    const env: NodeJS.ProcessEnv = {};
    const load = loadCredentials(credFile(`${API_KEY_ENV}=sk-ant-x`), env);
    const fromFile = capabilities({}, env, load).find((r) => r.name === "credential");
    expect(fromFile?.detail).toBe("file");
    const none = capabilities({}, {}).find((r) => r.name === "credential");
    expect({ reported: none?.reported, value: none?.value, detail: none?.detail }).toEqual({
      reported: false,
      value: false,
      detail: "absent",
    });
  });

  test("the config knob is validated like dataDir: a non-string is UNREADABLE", () => {
    expect(loadConfig({ credentialsFile: "/tmp/creds.env" }).config.credentialsFile).toBe("/tmp/creds.env");
    const bad = loadConfig({ credentialsFile: 42 });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unreadable");
    // And an unreadable configuration still stands down, credentials or not.
    expect(bad.config.observer).toBe(true);
  });

  // ── the two process entry points ─────────────────────────────────────────

  /** A host config file naming a credentials file, both under the temp dir. */
  function hostFiles(over: Record<string, unknown> = {}, body?: string): { cfg: string; creds: string } {
    const creds = credFile(body ?? `${API_KEY_ENV}=sk-ant-DAY0-TOKEN\n${EMBED_KEY_ENV}=pa-DAY0-TOKEN`);
    const cfg = join(host, "claude-code.json");
    writeFileSync(
      cfg,
      JSON.stringify({ dataDir: dir, injectionBudgetBytes: BUDGET_BYTES, owner: true, credentialsFile: creds, ...over }),
    );
    return { cfg, creds };
  }

  test("THE DAY-0 FAILURE, pinned: an empty hook environment refuses every spawn", () => {
    // What the host actually hands a hook process. Without the file this is the
    // whole run: no worker, no interpretation, and the parallel run measures
    // nothing while looking healthy.
    const cfg = join(host, "claude-code.json");
    writeFileSync(cfg, JSON.stringify({ dataDir: dir, owner: true }));
    const env: NodeJS.ProcessEnv = {};
    const { config: c, credentials } = hostConfig(cfg, env);
    expect(credentials.reason).toBe("not-configured");
    const plan = planSpawn({ config: c, command: "/bin/true", args: [], baseEnv: env });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe("NO_CREDENTIAL");
  });

  test("hostConfig fills the gap: capabilities say 'file' and planSpawn READIES", () => {
    const { cfg } = hostFiles();
    const env: NodeJS.ProcessEnv = {};
    const { config: c, credentials } = hostConfig(cfg, env);
    expect(credentials.reason).toBe("loaded");
    expect(credentials.loaded).toEqual([API_KEY_ENV, EMBED_KEY_ENV]);

    const row = capabilities(c, env, credentials).find((r) => r.name === "credential");
    expect({ reported: row?.reported, value: row?.value, detail: row?.detail }).toEqual({
      reported: true,
      value: true,
      detail: "file",
    });

    // The refusal becomes a plan, and the CHILD carries the key (§2.13's order
    // is untouched: the data dir is still pinned last).
    const plan = planSpawn({ config: c, command: "/bin/true", args: [], baseEnv: env });
    expect(plan.ok).toBe(true);
    expect(plan.reason).toBe("ready");
    expect(plan.env[API_KEY_ENV]).toBe("sk-ant-DAY0-TOKEN");
    expect(plan.env[EMBED_KEY_ENV]).toBe("pa-DAY0-TOKEN");
    expect(plan.env[DATA_DIR_ENV]).toBe(dir);
  });

  test("the ring records that the FILE answered — names and counts, never a value", () => {
    const { cfg } = hostFiles({}, `${API_KEY_ENV}=sk-ant-DAY0-TOKEN\nOPENAI_API_KEY=sk-ignored`);
    const env: NodeJS.ProcessEnv = {};
    const { config: c, credentials } = hostConfig(cfg, env);
    const { spawner } = fakeSpawner();
    const a = openAdapter(c, { command: "/bin/true", args: ["runner"], spawner, credentials });
    open.push(a.counterpart);

    const row = a.events(CREDENTIAL_FILE_EVENT);
    expect(row.length).toBe(1);
    expect(row[0]?.data).toEqual({
      reason: "loaded",
      loaded: API_KEY_ENV,
      skipped: "",
      ignoredLines: 1,
      mode: "600",
      permissive: false,
    });
    expect(a.capabilities().find((r) => r.name === "credential")?.detail).toBe("file");
  });

  test("the VALUE never reaches an event payload — the whole ring, scanned", () => {
    // THE PRODUCTION PATH, end to end, and the only test that runs it: the file
    // fills the REAL `process.env`, which is the `base` the spawner defaults to.
    // A fresh env object here would prove nothing — the token would never reach
    // anything `emit` could see, and the scan below would pass on its absence.
    // (`afterEach` restores both names; a dev machine's own key is saved too.)
    const { cfg } = hostFiles();
    delete process.env[API_KEY_ENV];
    delete process.env[EMBED_KEY_ENV];
    const { config: c, credentials } = hostConfig(cfg);
    expect(credentials.loaded).toEqual([API_KEY_ENV, EMBED_KEY_ENV]);

    const { calls, spawner } = fakeSpawner();
    const a = openAdapter(c, { command: "/bin/true", args: ["runner"], spawner, credentials });
    open.push(a.counterpart);
    a.hook("session-start", input());
    a.hook("stop", input());
    a.hook("session-end", input());

    // The plan PROVABLY held the token — the worker starts with the credential
    // the file supplied, which is the whole fix.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.env[API_KEY_ENV]).toBe("sk-ant-DAY0-TOKEN");
    expect(a.events("spawn.started").length).toBeGreaterThan(0);

    // ...and the ring provably did not. Names may travel; values may not.
    const ring = JSON.stringify(a.events());
    expect(ring).not.toContain("sk-ant-DAY0-TOKEN");
    expect(ring).not.toContain("pa-DAY0-TOKEN");
    expect(ring).toContain(API_KEY_ENV);
  });

  test("nothing is emitted when the ENVIRONMENT answered — the event is the record", () => {
    // The environment answered, so the file loaded no name and the ring stays
    // silent: the event's presence IS the record that the file was the source.
    const { cfg } = hostFiles();
    const env: NodeJS.ProcessEnv = { [API_KEY_ENV]: "sk-ant-from-the-environment", [EMBED_KEY_ENV]: "pa-env" };
    const { config: c, credentials } = hostConfig(cfg, env);
    expect(credentials.loaded).toEqual([]);
    expect(credentials.skippedPresent).toEqual([API_KEY_ENV, EMBED_KEY_ENV]);
    const { spawner } = fakeSpawner();
    const a = openAdapter(c, { command: "/bin/true", args: ["runner"], spawner, credentials });
    open.push(a.counterpart);
    expect(a.events(CREDENTIAL_FILE_EVENT)).toEqual([]);
  });

  test("THE RUNNER loads it too — belt and braces, and the PIN still wins", () => {
    const { cfg } = hostFiles({ dataDir: join(dir, "configured") });
    const pinned = join(dir, "pinned");
    const env: NodeJS.ProcessEnv = { [DATA_DIR_ENV]: pinned };
    const { config: c, credentials } = runnerConfig(cfg, env);
    expect(credentials.loaded).toEqual([API_KEY_ENV, EMBED_KEY_ENV]);
    expect(env[API_KEY_ENV]).toBe("sk-ant-DAY0-TOKEN");
    // The spawner wrote the data dir last precisely so nothing else can win.
    expect(c.dataDir).toBe(pinned);
    expect(c.credentialsFile).toBe(join(host, "creds.env"));
  });

  test("the runner honours an inherited key rather than overwriting it", () => {
    const { cfg } = hostFiles();
    const env: NodeJS.ProcessEnv = { [API_KEY_ENV]: "sk-ant-inherited-from-the-spawn" };
    const { credentials } = runnerConfig(cfg, env);
    expect(env[API_KEY_ENV]).toBe("sk-ant-inherited-from-the-spawn");
    expect(credentials.skippedPresent).toEqual([API_KEY_ENV]);
    expect(credentials.loaded).toEqual([EMBED_KEY_ENV]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the host's ask channel — measured on day 0 (2026-09-03), stderr + exit 2 on Stop", () => {
  const R = (over: Partial<{ injection: string | null; ask: string | null }>) => ({
    injection: null,
    ask: null,
    ...over,
  });

  test("session-start and user-prompt-submit deliver on stdout with exit 0 — the wake arrived that way", () => {
    expect(hostDelivery("session-start", R({ injection: "<counterparts>wake</counterparts>" }), {})).toEqual({
      stdout: "<counterparts>wake</counterparts>",
      stderr: "",
      exitCode: 0,
    });
    expect(hostDelivery("user-prompt-submit", R({ injection: "recall" }), {}).exitCode).toBe(0);
  });

  test("a Stop with an ask BLOCKS: the ask goes to stderr and the exit code is 2 (stdout reaches nobody on this host)", () => {
    const d = hostDelivery("stop", R({ ask: "Write what you learned, and the episode." }), {});
    expect(d).toEqual({ stdout: "", stderr: "Write what you learned, and the episode.", exitCode: 2 });
  });

  test("a Stop with nothing to ask exits 0 and prints nothing", () => {
    expect(hostDelivery("stop", R({}), {})).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test("the host's re-fired Stop (`stop_hook_active`) asks NOTHING — the anti-loop v1 carries for the same reason", () => {
    const d = hostDelivery("stop", R({ ask: "Write what you learned." }), { stop_hook_active: true });
    expect(d).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("ONE ask on ONE pacer — the host's Stop is every turn, the ask is not", () => {
  test("first Stop asks; the next Stop on the same experience does not; enough new substance asks again", () => {
    const { a } = adapter();
    const first = a.stop(input({ turns: BIG_TURNS }));
    expect(first.ask).toBe(stopAsk("s1", 1));
    // The same session, one more small turn: uncovered > 0, but paced out.
    const second = a.stop(input({ turns: [...(BIG_TURNS ?? []), { role: "user", text: "And one more short line for the record." }] }));
    expect(second.ask).toBeNull();
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.map((r) => r["outcome"])).toEqual(["asked", "paced"]);
    // Eight or more new turns AND eight thousand new bytes since the ask: asked
    // again. AND, not or — one of the two alone leaves the ask paced out.
    const more = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i}: a genuinely new stretch of conversation, long enough to matter. ${"x".repeat(1_000)}`,
    }));
    const third = a.stop(input({ turns: [...(BIG_TURNS ?? []), ...more] }));
    // Still chapter 1: nothing was written, so nothing was numbered.
    expect(third.ask).toBe(stopAsk("s1", 1));
  });

  test("the day's cap is shared, so a fresh session does not restart the allowance", () => {
    // The other instance's diagnosis, in one test: "the cadence assumed a
    // session equals a day". It does not — this host opens one per invocation.
    const { a } = adapter();
    for (let i = 0; i < 4; i += 1) {
      expect(a.stop(input({ sessionId: `s-day-${String(i)}`, turns: BIG_TURNS })).ask).not.toBeNull();
    }
    const fifth = a.stop(input({ sessionId: "s-day-4", turns: BIG_TURNS }));
    expect(fifth.ask).toBeNull();
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows[rows.length - 1]?.["outcome"]).toBe("capped");
    expect(rows[rows.length - 1]?.["reason"]).toBe("day-chapter-cap");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * THE LIVE-SESSION REGISTRY, written here because the hooks are the only thing
 * on this host that knows the session id.
 *
 * The MCP server this host launches is registered from a static configuration —
 * command, args, env — so it never learns which session it is serving, and for
 * the whole first run every dump was refused `no-bound-session`. These files are
 * the note that closes that gap; `test/sessions.test.ts` tests the module, and
 * what is tested HERE is that the hooks actually write it, at the right moments,
 * with the right scope.
 */
describe("the hooks record the live session for the tools to bind against", () => {
  const readRecord = (sessionId: string): SessionRecord | null => readSession(dir, sessionId);

  test("session-start records the session with the hook's own cwd as its scope", () => {
    const { a } = adapter();
    a.sessionStart(input());
    const rec = readRecord("s1");
    expect(rec?.sessionId).toBe("s1");
    expect(rec?.scope).toBe(canonicalScope("proj"));
    expect(rec?.endedAt).toBeNull();
    expect(isLive(rec as SessionRecord, Date.now())).toBe(true);
    expect(a.events("adapter.session.registry")[0]?.data).toEqual({ phase: "start", ok: true });
  });

  test("stop refreshes the clock BEFORE the ask that names the session goes out", () => {
    const { a } = adapter();
    const stopped = a.stop(input({ turns: BIG_TURNS }));
    const rec = readRecord("s1");
    // Created by Stop alone: a session already running when this shipped never
    // saw a SessionStart, and must still be bindable.
    expect(rec).not.toBeNull();
    expect(isLive(rec as SessionRecord, Date.now())).toBe(true);
    // The ask names the id the registry just made live.
    expect(stopped.ask).toContain("s1");
  });

  test("a stop from a WORKTREE does not move the project out from under the server", () => {
    const { a } = adapter();
    a.sessionStart(input({ scope: "proj" }));
    a.stop(input({ scope: "proj/.worktrees/wt" }));
    expect(readRecord("s1")?.scope).toBe(canonicalScope("proj"));
  });

  test("session-end closes the session: no later dump may claim it", () => {
    const { a } = adapter();
    a.sessionStart(input());
    a.sessionEnd(input());
    const rec = readRecord("s1") as SessionRecord;
    expect(rec.endedAt).not.toBeNull();
    expect(isLive(rec, Date.now())).toBe(false);
    expect(a.events("adapter.session.registry").map((e) => e.data?.["phase"])).toEqual([
      "start",
      "end",
    ]);
  });

  test("an observer records nothing — an instrument has no session to write under", () => {
    // An observer no longer mints an absent store (cli INTERFACE-GAPS §7).
    Counterpart.open({ dir, owner: true }).close();
    const { a } = adapter({ observer: true });
    a.sessionStart(input());
    a.stop(input());
    a.sessionEnd(input());
    expect(readRecord("s1")).toBeNull();
    expect(a.events("adapter.session.registry")).toEqual([]);
  });

  test("a registry that cannot be written never costs the boundary (§5 G2)", () => {
    const { a } = adapter();
    // The registry path is a FILE: every write below fails at the filesystem.
    writeFileSync(join(dir, "sessions"), "not a directory", "utf8");
    try {
      const stopped = a.stop(input());
      expect(stopped.ok).toBe(true);
      expect(stopped.spansAppended).toBeGreaterThan(0);
      expect(a.events("adapter.session.registry")[0]?.data).toEqual({
        phase: "boundary",
        ok: false,
      });
    } finally {
      rmSync(join(dir, "sessions"), { force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the one ask names the session and BOTH tools that take it", () => {
  test("the id is IN the ask, on both halves — it is what the server binds itself with", () => {
    const text = stopAsk("7c973b1c-d40a-47e5-92bb-8cdb1823a06d", 1);
    expect(text.split("7c973b1c-d40a-47e5-92bb-8cdb1823a06d").length - 1).toBe(2);
    expect(text).toContain("session_end");
    // The chapter door, which did not exist for the fortnight the ask named it.
    expect(text).toContain("chapter tool");
  });

  test("`updates` is named as a FIELD, never as prose to write", () => {
    // Four notes on the live host arrived as "updates: mem_x. …" in their own
    // body text, unlinked, because the old ask said "say `updates: <id>`".
    const text = stopAsk("s1", 1);
    expect(text).toContain("FIELD");
    expect(text).not.toContain("say `updates:");
  });

  test("salience is named as the author's to set, with the default said out loud", () => {
    // An unclaimed authored memory takes a modest default floor, below the
    // semantic band (`physics/`, 2026-09-04), and the author's claim is the only
    // channel by which lived testimony outranks what a sweep noticed.
    const text = stopAsk("s1", 1);
    expect(text).toContain("`salience` (0-1)");
    expect(text).toContain("modest default");
  });

  test("it keeps the two sentences that sanction an honest no", () => {
    const text = stopAsk("s1", 2);
    expect(text).toContain("Nothing worth keeping is a real answer");
    expect(text).toContain("a short true episode beats a manufactured deep one");
  });

  test("a later chapter names its NUMBER, and the number is the store's", () => {
    expect(stopAsk("s1", 3)).toContain("Add chapter 3");
    expect(stopAsk("s1", 1)).not.toContain("Add chapter");
  });

  test("it stays short — a model reads this at every Stop that is due one", () => {
    const text = stopAsk("7c973b1c-d40a-47e5-92bb-8cdb1823a06d", 1);
    expect(text.split("\n").length).toBeLessThanOrEqual(6);
    // Shorter than the PAIR it replaces (~1,080 bytes across two texts), and
    // asked far less often — the point of the budget is the blocked moment.
    expect(text.length).toBeLessThan(1_050);
  });

  test("the re-fired Stop still asks NOTHING — the anti-loop is untouched", () => {
    const d = hostDelivery(
      "stop",
      { injection: "", ask: stopAsk("s1", 1) },
      { stop_hook_active: true },
    );
    expect(d).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The semantic channel, wired: a LAGGED cue, and the backfill that feeds it
// ═══════════════════════════════════════════════════════════════════════════
/**
 * THE MEASURED FAILURE (2026-09-04, live store): `RecallTurn.vector` existed
 * from `recall/`'s first commit and NEITHER live path set it — the hook built
 * its turn without one, the MCP tool built its own — so 13,862 embeddings were
 * consulted by nothing live, and 40 authored notes, 224 episodes and 288
 * migrated memories had no vector at all.
 *
 * The ruling: do not embed on the hot path. Compute the cue after a turn, in the
 * worker, and use it on the NEXT one. And rank it there too — `nearestTo` over a
 * live-sized index measured 590-1040 ms, which the 1200 ms budget cannot pay.
 *
 * These tests hold both halves to it, and hold the prompt path to opening no
 * socket at all.
 */
describe("the lagged semantic cue — computed after a turn, used on the next", () => {
  /**
   * A deterministic embedder over THREE topics. Not `vectorFor`: this block
   * needs to assert WHICH memory the semantic channel reached, and a hash-shaped
   * vector makes "the otter memory came back" an accident rather than a claim.
   */
  function topicEmbedder(): LiveEmbedder & { warmed: string[]; asked: string[] } {
    const warmed: string[] = [];
    const asked: string[] = [];
    const cache = new Map<string, number[]>();
    const vec = (t: string): number[] => {
      const l = t.toLowerCase();
      if (l.includes("otter")) return [1, 0, 0];
      if (l.includes("kite")) return [0, 1, 0];
      return [0, 0, 1];
    };
    return {
      warmed,
      asked,
      model: "test-embed-1",
      embed: (t: string) => cache.get(t) ?? null,
      vector: async (t: string) => {
        asked.push(t);
        const v = vec(t);
        cache.set(t, v);
        return v;
      },
      warm: async (texts: readonly string[]) => {
        for (const t of texts) {
          warmed.push(t);
          cache.set(t, vec(t));
        }
        return texts.length;
      },
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0 }),
    };
  }

  /** An embedder that is switched on and answers NOTHING — a live client whose
   *  every call refused, which is what a bad key looks like from up here. */
  function deadEmbedder(): LiveEmbedder {
    return {
      model: "test-embed-1",
      embed: () => null,
      vector: async () => null,
      warm: async () => 0,
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0 }),
    };
  }

  function brain(embedder: LiveEmbedder | null): Counterpart {
    const c = Counterpart.open({
      dir,
      owner: true,
      budgetBytes: BUDGET_BYTES,
      ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
    });
    open.push(c);
    return c;
  }

  /** Enough memories that the gate leaves the cold-start regime. */
  function seed(c: Counterpart): { otter: string; kite: string } {
    const otter = c.store.put({
      type: "memory",
      kind: "fact",
      title: "The otter survey",
      body: "The otter survey on the river counted eleven holts this spring.",
    });
    const kite = c.store.put({
      type: "memory",
      kind: "fact",
      title: "The kite festival",
      body: "The kite festival moved to the headland because of the wind.",
    });
    for (let i = 0; i < 18; i += 1) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `Filler memory number ${i}: an unremarkable fact about ordinary things.`,
      });
    }
    return { otter, kite };
  }

  test("the worker leaves the cue; the NEXT turn uses it, and says where it came from", async () => {
    const emb = topicEmbedder();
    const c = brain(emb);
    const { otter } = seed(c);
    // Every memory gets its vector the guaranteed way: the backfill, not a
    // deposit that happened to pay for one.
    await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true });

    // Turn 1 — the semantic channel is dark, and the record says so BY NAME
    // rather than with the bare `semanticUsed: false` that told nobody anything.
    const first = c.recallForTurn({ sessionId: "s-lag", text: "What did we settle about the river?" });
    expect(first.decision.semanticUsed).toBe(false);
    expect(first.decision.semanticSource).toBe("none");
    expect(first.decision.turn).toBe(1);

    // The turn is captured, then the worker runs — exactly the live order.
    c.captureSpans({
      session: "s-lag",
      scope: "proj",
      turns: [
        { role: "user", text: "How many holts did the otter survey find?" },
        { role: "assistant", text: "Eleven, on the river stretch." },
      ],
    });
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s-lag",
      scope: "proj",
      embedder: emb,
      hasCredential: true,
    });
    expect(lag.reason).toBe("ok");
    expect(lag.stored).toBe(true);
    expect(lag.hits).toBeGreaterThan(0);

    // Turn 2 — a prompt with NO lexical overlap with the otter memory. Lexically
    // it reaches nothing; the lagged cue is the only way in.
    const second = c.recallForTurn({ sessionId: "s-lag", text: "And the count, remind me?" });
    expect(second.decision.semanticUsed).toBe(true);
    expect(second.decision.semanticSource).toBe("lagged");
    expect(second.decision.semanticFromTurn).toBe(1);
    expect(second.decision.verdicts.map((v) => v.id)).toContain(otter);
  });

  test("it expires after exactly ONE turn — the carried-cue rule, same reason", async () => {
    const emb = topicEmbedder();
    const c = brain(emb);
    seed(c);
    await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true });

    c.recallForTurn({ sessionId: "s-exp", text: "A first turn about the otter survey." });
    c.captureSpans({
      session: "s-exp",
      scope: "proj",
      turns: [
        { role: "user", text: "How many holts did the otter survey find?" },
        { role: "assistant", text: "Eleven." },
      ],
    });
    await laggedSemantic({
      counterpart: c,
      sessionId: "s-exp",
      scope: "proj",
      embedder: emb,
      hasCredential: true,
    });

    // Turn 2 spends it.
    expect(c.recallForTurn({ sessionId: "s-exp", text: "And the count?" }).decision.semanticSource).toBe(
      "lagged",
    );
    // Turn 3 — no worker ran in between, so the cue is a turn too old. STALE, by
    // name, never silently reused: a cue from two turns ago is a cue for a
    // conversation that has moved.
    const third = c.recallForTurn({ sessionId: "s-exp", text: "One more question." });
    expect(third.decision.semanticSource).toBe("stale");
    expect(third.decision.semanticUsed).toBe(false);
    expect(third.decision.semanticFromTurn).toBe(1);
  });

  test("no credential ⇒ nothing is stored to use, and the next turn NAMES it", async () => {
    const c = brain(topicEmbedder());
    seed(c);
    c.captureSpans({
      session: "s-nokey",
      scope: "proj",
      turns: [{ role: "user", text: "Anything about the otter survey?" }],
    });
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s-nokey",
      scope: "proj",
      embedder: topicEmbedder(),
      hasCredential: false,
    });
    expect(lag.reason).toBe("no-credentials");
    expect(lag.hits).toBe(0);

    const turn = c.recallForTurn({ sessionId: "s-nokey", text: "The count, again?" });
    expect(turn.decision.semanticUsed).toBe(false);
    // The whole point: a NAMED state, not a silence indistinguishable from a
    // session nobody has spoken in (scar §2.4).
    expect(turn.decision.semanticSource).toBe("no-credentials");
  });

  test("an embedder that answers nothing is `embed-failed`, and an absent one `embedder-off`", async () => {
    const c = brain(null);
    seed(c);
    c.captureSpans({
      session: "s-dead",
      scope: "proj",
      turns: [{ role: "user", text: "Anything about the kite festival?" }],
    });
    expect(
      (await laggedSemantic({ counterpart: c, sessionId: "s-dead", scope: "proj", embedder: null, hasCredential: true }))
        .reason,
    ).toBe("embedder-off");
    expect(
      (
        await laggedSemantic({
          counterpart: c,
          sessionId: "s-dead",
          scope: "proj",
          embedder: deadEmbedder(),
          hasCredential: true,
        })
      ).reason,
    ).toBe("embed-failed");
    expect(c.recallForTurn({ sessionId: "s-dead", text: "Well?" }).decision.semanticSource).toBe(
      "embed-failed",
    );
  });

  test("a session with nothing captured is `no-text`, not a vector of the empty string", async () => {
    const c = brain(topicEmbedder());
    const emb = topicEmbedder();
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s-silent",
      scope: "proj",
      embedder: emb,
      hasCredential: true,
    });
    expect(lag.reason).toBe("no-text");
    expect(emb.asked).toEqual([]);
  });

  test("the cue is BOUNDED and STRIPPED — the prompt leads, the reply is clipped (§9 G3)", () => {
    const c = brain(topicEmbedder());
    c.captureSpans({
      session: "s-clip",
      scope: "proj",
      turns: [
        {
          role: "user",
          text: `<system-reminder>host boilerplate</system-reminder>The otter question. ${"p".repeat(4_000)}`,
        },
        { role: "assistant", text: `The answer. ${"r".repeat(4_000)}` },
      ],
    });
    const text = lagText(c, "s-clip", "proj");
    expect(text).not.toContain("system-reminder");
    expect(text.length).toBeLessThanOrEqual(LAG_PROMPT_BYTES + LAG_REPLY_BYTES + 2);
    // The prompt LEADS: a cue that kept only the reply is a cue for the answer,
    // not for what the conversation is about.
    expect(text.startsWith("The otter question.")).toBe(true);
  });

  test("under OBSERVER nothing is written — the instrument leaves the world as it found it", async () => {
    Counterpart.open({ dir }).close();
    const c = Counterpart.open({ dir, observer: true });
    open.push(c);
    c.captureSpans({ session: "s-obs", scope: "proj", turns: [{ role: "user", text: "Otter?" }] });
    const lag = await laggedSemantic({
      counterpart: c,
      sessionId: "s-obs",
      scope: "proj",
      embedder: topicEmbedder(),
      hasCredential: true,
    });
    expect(lag.stored).toBe(false);
    expect(c.store.gateRecords("s-obs")).toEqual([]);
  });
});

describe("the embedding backfill — the guaranteed path to a vector", () => {
  function counting(): LiveEmbedder & { warmed: string[] } {
    const warmed: string[] = [];
    const cache = new Map<string, number[]>();
    return {
      warmed,
      model: "test-embed-1",
      embed: (t: string) => cache.get(t) ?? null,
      vector: async (t: string) => {
        cache.set(t, vectorFor(t));
        return vectorFor(t);
      },
      warm: async (texts: readonly string[]) => {
        for (const t of texts) {
          warmed.push(t);
          cache.set(t, vectorFor(t));
        }
        return texts.length;
      },
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0 }),
    };
  }

  function brain(embedder: LiveEmbedder | null): Counterpart {
    const c = Counterpart.open({
      dir,
      owner: true,
      ...(embedder === null ? {} : { embed: embedder.embed, vectors: embedder }),
    });
    open.push(c);
    return c;
  }

  test("first-person material first, oldest inside each group, capped at the limit", async () => {
    const emb = counting();
    const c = brain(emb);
    // Ordinary swept material, born first — so a pure oldest-first order would
    // take these and leave the authored notes blind for runs.
    const swept = [0, 1, 2].map((i) =>
      c.store.put({ type: "memory", kind: "fact", body: `A swept observation ${i}.`, source: "fallback" }),
    );
    const authored = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Something I chose to write down myself.",
      source: "authored",
    });
    const episode = c.store.put({ type: "episode", kind: "self", body: "A chapter of my own." });

    const report = await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true, limit: 2 });
    expect(report.reason).toBe("ran");
    expect(report.attempted).toBe(2);
    expect(report.embedded).toBe(2);
    expect(report.failed).toBe(0);
    // THE ORDER IS THE CLAIM: the authored note and the episode, not the three
    // older swept ones.
    const got = new Set(
      c.store.nearestTo(vectorFor(indexTextOf("", "x")), 100).map((h) => h.id),
    );
    expect(got.has(authored)).toBe(true);
    expect(got.has(episode)).toBe(true);
    for (const id of swept) expect(got.has(id)).toBe(false);
    // And the remainder is reported, so a coverage watch has a number that falls.
    expect(report.remaining).toBe(3);

    const rest = await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true });
    expect(rest.embedded).toBe(3);
    expect(rest.remaining).toBe(0);
    expect((await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true })).reason).toBe(
      "nothing-missing",
    );
  });

  test("the counts are DURABLE — a coverage watch reads them out of the store tomorrow", async () => {
    const emb = counting();
    const c = brain(emb);
    c.store.put({ type: "memory", kind: "fact", body: "One memory with no vector yet." });
    await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true });
    const rows = c.store
      .eventLog({ name: "adapter.embed.backfill", limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect(rows[0]?.["embedded"]).toBe(1);
    expect(rows[0]?.["remaining"]).toBe(0);
    expect(rows[0]?.["failed"]).toBe(0);
  });

  test("a warm that filled the WRONG key reports zero, never a success over an empty table", async () => {
    // The seam that can silently break: `warm()` caches by whatever string it
    // was handed, and `embedOne` looks up `indexTextOf(title, body)`. This
    // embedder warms under a mangled key — every lookup misses.
    const cache = new Map<string, number[]>();
    const wrong: LiveEmbedder = {
      model: "test-embed-1",
      embed: (t: string) => cache.get(t) ?? null,
      vector: async () => null,
      warm: async (texts: readonly string[]) => {
        for (const t of texts) cache.set(`mangled:${t}`, vectorFor(t));
        return texts.length;
      },
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0 }),
    };
    const c = brain(wrong);
    c.store.put({ type: "memory", kind: "fact", body: "A memory whose vector will be cached wrong." });
    const report = await backfillVectors({ counterpart: c, embedder: wrong, hasCredential: true });
    expect(report.attempted).toBe(1);
    expect(report.embedded).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.remaining).toBe(1);
  });

  test("it writes the VECTOR row and leaves `doc_tokens` untouched", async () => {
    // The reason this is a test and not a comment: `indexDoc` would have been
    // the obvious reuse, and it DELETEs and re-inserts every token row. The text
    // has not changed, so that is 64 rewrites per Stop on the 263 MB index whose
    // page-cache warming is exactly why `recall/`'s BUDGET_MS went 250 -> 1200.
    // A backfill that made the cold recall slower would be self-defeating.
    const emb = counting();
    const c = brain(emb);
    const id = c.store.put({ type: "memory", kind: "fact", body: "A memory with tokens already indexed." });
    expect(c.store.search("indexed", 5).map((h) => h.id)).toContain(id);

    await backfillVectors({ counterpart: c, embedder: emb, hasCredential: true });
    // The lexical index still answers, and the vector row now exists.
    expect(c.store.search("indexed", 5).map((h) => h.id)).toContain(id);
    expect(c.store.nearestTo(vectorFor(indexTextOf("", "x")), 5).map((h) => h.id)).toContain(id);

    // Greps for the CONSUMER, not the comment (scar §2.6's own method): the one
    // write path the backfill uses must not be the token-rewriting one.
    const src = readFileSync(fileURLToPath(new URL("../src/core/store/index.ts", import.meta.url)), "utf8");
    const body = src.slice(src.indexOf("  embedOne(id: string)"));
    const method = body.slice(0, body.indexOf("\n  }\n"));
    expect(method).toContain("setEmbedding(");
    expect(method).not.toContain("indexDoc(");
  });

  test("off, and refused, are two records — never one zero (scar §2.4)", async () => {
    const c = brain(null);
    c.store.put({ type: "memory", kind: "fact", body: "A memory nobody will embed today." });
    expect((await backfillVectors({ counterpart: c, embedder: null, hasCredential: true })).reason).toBe(
      "embedder-off",
    );
    expect(
      (await backfillVectors({ counterpart: c, embedder: counting(), hasCredential: false })).reason,
    ).toBe("no-credentials");
  });
});

describe("the prompt path opens NO socket — the ruling, mechanized", () => {
  test("user-prompt-submit makes no network call, by either route", () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    (globalThis as { fetch: unknown }).fetch = (url: unknown): never => {
      calls.push(String(url));
      throw new Error("the prompt path opened a socket");
    };
    try {
      const { calls: spawns, spawner } = fakeSpawner();
      const a = openAdapter(config({ embedder: { enabled: true } }), {
        command: "/bin/true",
        args: ["runner"],
        spawner,
        // The OTHER route: the adapter's own injected fetch. A hook that reached
        // it would fail here rather than pass quietly.
        embedFetch: () => {
          throw new Error("the prompt path opened a socket");
        },
      });
      open.push(a.counterpart);
      const out = a.userPromptSubmit(input({ prompt: "Anything about the storage split?" }));
      expect(out.ok).toBe(true);
      expect(calls).toEqual([]);
      expect(spawns.length).toBe(0);
    } finally {
      (globalThis as { fetch: unknown }).fetch = realFetch;
    }
  });

  test("Stop pins the session and scope onto the worker, so the cue has an owner", () => {
    const { a, calls } = adapter();
    a.stop(input());
    expect(calls.length).toBe(1);
    expect(calls[0]?.env[SESSION_ENV]).toBe("s1");
    expect(calls[0]?.env[SCOPE_ENV]).toBe("proj");
  });

  test("the recall row records WHERE the semantic input came from", () => {
    const { a } = adapter();
    a.userPromptSubmit(input({ prompt: "Anything about the storage split?" }));
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.recall", limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect(rows[0]?.["semantic"]).toBe("none");
  });
});
