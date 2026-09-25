/**
 * `adapters/claude-code/` — the launch adapter, with the host faked.
 *
 * The host is faked in one direction only: its EVENTS and its transcript. Every
 * other thing under test is the real object — a real `Counterpart` over a real
 * temp data dir, the real span buffer, the real gate battery. What a fake host
 * buys is determinism about the one surface this adapter exists to isolate.
 *
 * NO TEST HERE MAKES A NETWORK CALL — and since 2026-09-24 there is no network
 * code in the adapter to make one (the Anthropic and Voyage clients were
 * removed); embedders here are local fakes.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir per test, removed
 * in `afterEach`, and `store/paths.ts` structurally refuses `~/.bansai`.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_EVENT,
  Counterpart,
  PRIMACY_DELIVER_EVENT,
  PRIMACY_STANDDOWN_EVENT,
  RUNNER_FAILED_EVENT,
  SPAWN_REFUSED_EVENT,
  SPAWN_STARTED_EVENT,
  SWEEP_GATE_EVENT,
} from "../src/core/counterpart.js";
import { EMBED_SKIP_AFTER, indexTextOf } from "../src/core/store/index.js";
import { canonicalScope, isLive, readSession, recordSession } from "../src/adapters/sessions.js";
import type { SessionRecord } from "../src/adapters/sessions.js";
import { OK_STOP_REASONS, TUNABLES as REMEMBER, enters, validateWatchdog } from "../src/core/remember/index.js";
import { BOOTSTRAP, BRIEFING_KEY, SELF_TUNABLES } from "../src/core/self/index.js";
import {
  AB_DIR_ENV,
  stopAsk,
  BOUNDARY_KIND,
  ClaudeCodeAdapter,
  DATA_DIR_ENV,
  FOREIGN_MARKERS,
  HOOKS,
  SESSION_ENDING,
  TUNABLES,
  abDir,
  assignmentHealth,
  assignmentPath,
  attributePeers,
  capabilities,
  classifyBlock,
  loadConfig,
  openAdapter,
  openEmbedder,
  parseTranscript,
  readWakeArrival,
  WAKE_HEAD_MAX_BYTES,
  WAKE_HEAD_MAX_LINES,
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
  SPAWN_REFUSAL_PREFIX,
  SPAWN_START_COUNT_KEY,
  SPAWN_START_DATE_KEY,
  spawnDetached,
  substanceOf,
} from "../src/adapters/claude-code/index.js";
import type {
  AdapterConfig,
  HookInput,
  HookName,
  LiveEmbedder,
  SpawnPlan,
} from "../src/adapters/claude-code/index.js";
import { hostConfig, hostDelivery } from "../src/adapters/claude-code/bin/hook.js";
import { runOnce, runnerConfig } from "../src/adapters/claude-code/bin/runner.js";
import { STOP_HUMAN_LINE } from "../src/adapters/claude-code/hooks.js";
import { toolSpec } from "../src/adapters/mcp/index.js";

/**
 * The wake's first line, and a recall note's, is the person's clock since
 * 2026-09-25 (docs/time.md rule 5). Checked for shape and taken off, so the
 * block underneath is compared exactly as before.
 */
const NOW_LINE = /^Now: [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} [ap]m \S+\n/;
function withoutNow(text: string): string {
  expect(text).toMatch(NOW_LINE);
  return text.replace(NOW_LINE, "");
}

const ENV = "COUNTERPARTS_DATA_DIR";
const BUDGET_BYTES = 9000;

let dir: string;
let priorEnv: string | undefined;
/** The A/B directory, redirected FOR THE WHOLE FILE. The owner's machine has a
 *  real `~/.memory-ab/assignment.json` — v1's live switch — and a test that
 *  read it would be reading production state and could flip with the day. */
let abHome: string;
let priorAbDir: string | undefined;
/** Where the FAKE HOST keeps its transcripts — outside the data dir, because
 *  the store refuses a top-level entry its own layout does not name. */
let hostDir: string;
const open: Counterpart[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorAbDir = process.env[AB_DIR_ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-cc-"));
  abHome = mkdtempSync(join(tmpdir(), "counterparts-ab-"));
  hostDir = mkdtempSync(join(tmpdir(), "counterparts-host-"));
  process.env[ENV] = dir;
  process.env[AB_DIR_ENV] = abHome;
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
  rmSync(dir, { recursive: true, force: true });
  rmSync(abHome, { recursive: true, force: true });
  rmSync(hostDir, { recursive: true, force: true });
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

/**
 * A counterpart that really is an observer. `ClaudeCodeAdapter` takes its
 * stance from the COUNTERPART (`hooks.ts`: `this.observer =
 * opts.counterpart.observer`), so `config({ observer: true })` over a writer
 * makes an adapter that is not standing down at all — and a test that assumed
 * otherwise would pass for a reason unrelated to the guard it names.
 */
function observerCounterpart(): Counterpart {
  const c = Counterpart.open({ dir, observer: true });
  open.push(c);
  return c;
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
 * chapter's, so a Stop now has to have earned it — here, seven typed turns.
 */
const BIG_TURNS: HookInput["turns"] = Array.from({ length: 14 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `Turn ${i}: ${"a real exchange with enough substance in it to pace a ritual honestly, said at the length people actually work at, which is what the byte half of the threshold is measuring rather than the turn half. ".repeat(2)}`,
}));

/** A lone UTF-16 surrogate, the thing I33's two migrated titles carried. No
 *  `g` flag: `.test()` on a global regex carries `lastIndex` between calls and
 *  would quietly skip every other input. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function input(over: Partial<HookInput> = {}): HookInput {
  return { sessionId: "s1", scope: "proj", turns: TURNS, at: "2026-01-02", ...over };
}

/**
 * THE SESSION RECORD `SessionStart` WRITES, without the wake around it.
 *
 * Since the retroactive-capture guard (#92 review, F1) a boundary whose session
 * has NO record and a cursor still at 0 SEALS the stretch instead of capturing
 * it — that is what a session which lived under `off` looks like from the
 * boundary's side. An ordinary session has a record from its SessionStart, so a
 * test about ordinary capture has to look like one.
 */
function live(a: ClaudeCodeAdapter, sessionId = "s1", scope = "proj"): void {
  recordSession(a.counterpart.store.dir, { sessionId, scope, phase: "start" });
}

/**
 * A SESSION-START HOOK'S OUTPUT, AS THIS HOST RECORDS IT — the shape measured
 * 2026-09-17 on Claude Code 2.1.274 from a live transcript: an entry of its own
 * with `type: "attachment"`, before the first user message, carrying what the
 * hook printed (`stdout`) beside what the host says it injected (`content`).
 *
 * Every hook on the event leaves one of these, which is why `command` is a
 * field and not a constant: the check has to pick its own out of the pile.
 */
function hookAttachment(
  over: {
    stdout?: string;
    content?: string | null;
    /** Leave the `content` key OFF entirely — a host build that records only stdout. */
    contentAbsent?: boolean;
    command?: string;
    hookEvent?: string;
    hookName?: string;
  } = {},
): Record<string, unknown> {
  const stdout = over.stdout ?? "";
  return {
    type: "attachment",
    uuid: "att-1",
    attachment: {
      type: "hook_success",
      hookEvent: over.hookEvent ?? "SessionStart",
      hookName: over.hookName ?? "counterparts",
      command: over.command ?? "bun run /repo/src/adapters/claude-code/bin/hook.ts",
      stdout,
      ...(over.contentAbsent === true ? {} : { content: over.content === undefined ? stdout : over.content }),
      stderr: "",
      exitCode: 0,
      durationMs: 37,
      toolUseID: "hook-abc",
    },
  };
}

/** One JSONL file under the temp dir, named so each test gets its own. */
let transcriptSeq = 0;
function writeTranscript(entries: readonly unknown[]): string {
  const root = hostDir;
  transcriptSeq += 1;
  const path = join(root, `t${String(transcriptSeq)}.jsonl`);
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  return path;
}

/** The two entries that stand before the attachment in a real file. */
const PREAMBLE: readonly unknown[] = [
  { type: "summary", summary: "a resumed session's summary line", leafUuid: "x" },
  { type: "system", subtype: "init", cwd: "/repo", uuid: "sys-1" },
];

/** The last `adapter.wake.delivered` row this adapter wrote, as data. */
function deliveredRow(a: ClaudeCodeAdapter): Record<string, unknown> {
  const rows = a.events("adapter.wake.delivered");
  return (rows[rows.length - 1]?.data ?? {}) as Record<string, unknown>;
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

  test("the network surface is ENUMERATED — no outbound client, no endpoint, no SDK (scar E2's chokepoint)", () => {
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
    // NO endpoint anywhere (keyless, owner 2026-09-24). Until then both lived in
    // config.ts, where an owner could read the whole egress surface on one page;
    // the Anthropic and Voyage clients were removed, and with them the list.
    expect(endpoints).toEqual([]);
    // And exactly one file resolves a network verb, named. The list is the
    // point: a second one appearing is a review event, not a merge.
    //
    // THE ONE ENTRY IS INBOUND, AND THAT DIFFERENCE IS THE WHOLE REVIEW.
    // `adapters/dashboard/web/server.ts` imports `node:http` to LISTEN on
    // 127.0.0.1 — it opens no connection, resolves no host, and sends nothing
    // anywhere; `createServer`/`listen` are the only two verbs it uses. It was
    // reviewed on exactly the terms this comment block asked for (owner ruling
    // 2026-09-04, the local web dashboard), and it is added here rather than
    // excluded by a pattern, so the next reader still has to read it.
    expect(callers.sort()).toEqual(["adapters/dashboard/web/server.ts"]);
    // The inbound claim, mechanized: the server never calls an outbound verb.
    const server = readFileSync(join(SRC, "adapters/dashboard/web/server.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");
    expect(/\bfetch\s*\(/.test(server)).toBe(false);
    expect(/\.request\s*\(|\.connect\s*\(|https?:\/\/(?!127\.0\.0\.1|localhost)/.test(server)).toBe(
      false,
    );
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
      live(a, `s-${hook}`);
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
    expect(withoutNow(result.injection)).toBe(BOOTSTRAP);
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
    // The clock line rides ABOVE the wake block (docs/time.md rule 5), outside
    // its accounting: everything below is the block, counted as before.
    const wake = withoutNow(result.injection);
    const lines = wake.split("\n");
    expect(lines[0] ?? "").toContain("<!-- counterparts:wake ");
    expect(lines[1] ?? "").toContain("Counterparts memory, day ");
    expect(lines[1] ?? "").toContain("2026-01-02");
    expect(lines[1] ?? "").toContain(" memories ");

    // Counted: the hook's bytes, the sentinel's bytes and the text agree, and
    // the whole thing still fits what the host said it can carry.
    expect(result.bytes).toBe(Buffer.byteLength(wake, "utf8"));
    expect(result.sentinel).toContain(`bytes=${result.bytes}`);
    expect(lines[lines.length - 1] ?? "").toBe(result.sentinel as string);
    expect(result.bytes).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(a.events("adapter.injection.overbudget").length).toBe(0);
    expect(a.events("adapter.wake.injected")[0]?.data?.preface).toBe(true);

    // Composed at DELIVERY: the published row carries no preface at all.
    expect(a.counterpart.store.getMeta(BRIEFING_KEY) ?? "").not.toContain("Counterparts memory, day ");

    // And the delivered loop still closes, on the bundle the host recorded.
    const path = writeTranscript([...PREAMBLE, hookAttachment({ stdout: result.injection })]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    expect(deliveredRow(a)["outcome"]).toBe("delivered");
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

});

// ═══════════════════════════════════════════════════════════════════════════
// The wake's arrival
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Scar §2.3's other half, and the wiring fault that kept it inert.
 *
 * The check ran on a field nobody ever set, against an expectation held in a
 * `Map` on an adapter instance — and every hook is its own process, so the
 * expectation was always empty. `adapter.wake.delivered` wrote 0 rows in two
 * weeks of live running (mechanism inventory 2026-09-17, S2). What it reads now
 * is the host's own record of what it injected, in the head of the transcript.
 */
describe("the wake's arrival — one durable answer per session (scar §2.3)", () => {
  /** A woken session: a published bundle, a SessionStart, the sentinel it printed. */
  async function woken(sessionId = "s1"): Promise<{
    a: ClaudeCodeAdapter;
    injection: string;
    sentinel: string;
  }> {
    const { a } = adapter();
    a.counterpart.store.put({
      type: "memory",
      kind: "fact",
      body: "The storage split put canonical prose on disk and one small operational database.",
      salience: { novelty: null, relevance: 0.9, emotional: 0.6, predictive: 0.8 },
      physics: { birthDay: 0, lastUsedDay: 0 },
    });
    await a.counterpart.sessionEnd({ date: "2026-01-02", budgetBytes: BUDGET_BYTES });
    const woke = a.sessionStart(input({ sessionId }));
    expect(woke.sentinel).not.toBe(null);
    return { a, injection: woke.injection, sentinel: woke.sentinel as string };
  }

  test("(a) an intact wake leaves ONE row saying `delivered`", async () => {
    const { a, injection, sentinel } = await woken();
    const path = writeTranscript([...PREAMBLE, hookAttachment({ stdout: injection })]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));

    const rows = a.events("adapter.wake.delivered");
    expect(rows.length).toBe(1);
    const row = rows[0]?.data ?? {};
    expect({
      outcome: row["outcome"],
      ok: row["ok"],
      found: row["found"],
      expected: row["expected"],
      headInContent: row["headInContent"],
      tailInContent: row["tailInContent"],
      tailInStdout: row["tailInStdout"],
      transcript: row["transcript"],
    }).toEqual({
      outcome: "delivered",
      ok: true,
      found: true,
      expected: true,
      headInContent: true,
      tailInContent: true,
      tailInStdout: true,
      transcript: "read",
    });
    // The sentinels' own accounting, on the row: what the head declared, what
    // the tail declared, and what actually arrived.
    expect(row["headBytes"]).toBe(row["tailBytes"]);
    expect(row["contentBytes"]).toBe(Buffer.byteLength(injection, "utf8"));
    expect(sentinel).toContain(`bytes=${String(row["tailBytes"])}`);
    // And the expectation lives where a FRESH PROCESS can read it.
    expect(readSession(dir, "s1")?.wakeSentinel).toBe(sentinel);
  });

  test("(b) a tail the host never injected is `truncated`, with the byte numbers", async () => {
    const { a, injection } = await woken();
    // The host clipped the last line off what it placed in context. The hook
    // still PRINTED it — which is exactly the pair v1 could not see.
    const lines = injection.split("\n");
    const clipped = lines.slice(0, -1).join("\n");
    const path = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ stdout: injection, content: clipped }),
    ]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));

    const row = deliveredRow(a);
    expect({
      outcome: row["outcome"],
      ok: row["ok"],
      tailInContent: row["tailInContent"],
      tailInStdout: row["tailInStdout"],
      headInContent: row["headInContent"],
    }).toEqual({
      outcome: "truncated",
      ok: false,
      tailInContent: false,
      tailInStdout: true,
      headInContent: true,
    });
    // The numbers that say HOW MUCH was lost: the head sentinel's declared
    // total (the wake block's, which the clock line above it is not part of),
    // against what the host actually carried.
    expect(row["headBytes"]).toBe(Buffer.byteLength(withoutNow(injection), "utf8"));
    expect(row["contentBytes"]).toBe(Buffer.byteLength(clipped, "utf8"));
    expect(row["stdoutBytes"]).toBe(Buffer.byteLength(injection, "utf8"));
    expect(row["tailBytes"]).toBe(null);
  });

  test("(c) no attachment is `not-found` when a wake was expected", async () => {
    const { a } = await woken();
    const path = writeTranscript([
      ...PREAMBLE,
      { type: "user", message: { role: "user", content: "hello" } },
    ]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    const row = deliveredRow(a);
    expect({ outcome: row["outcome"], found: row["found"], transcript: row["transcript"] }).toEqual({
      outcome: "not-found",
      found: false,
      transcript: "read",
    });
  });

  test("(c) a cold start expected nothing, and the row says so rather than crying loss", () => {
    // No published bundle: the wake is the bootstrap line, which states no
    // sentinel, so nothing checkable was ever handed to the host.
    const { a } = adapter();
    const woke = a.sessionStart(input());
    expect(woke.sentinel).toBe(null);
    expect(readSession(dir, "s1")?.wakeSentinel).toBe(undefined);

    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: writeTranscript(PREAMBLE) }));
    const row = deliveredRow(a);
    expect({ outcome: row["outcome"], expected: row["expected"], transcript: row["transcript"] }).toEqual({
      outcome: "no-wake-expected",
      expected: false,
      // Nothing was supposed to arrive, so the file is not opened at all.
      transcript: "not-read",
    });
  });

  test("(d) ANOTHER hook's SessionStart attachment is not this hook's answer", async () => {
    const { a, injection } = await woken();
    const path = writeTranscript([
      ...PREAMBLE,
      // A neighbour's hook, on the same event, printing a whole wake-looking
      // block. Matching on the event alone would read this as ours.
      hookAttachment({
        hookName: "somebody-else",
        command: "node /elsewhere/greet.js",
        stdout: injection,
      }),
    ]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    expect(deliveredRow(a)["outcome"]).toBe("not-found");

    // And with BOTH present, ours is the one that answers.
    const { a: b, injection: mine } = await woken("s2");
    const both = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ hookName: "somebody-else", command: "node /elsewhere/greet.js", stdout: "" }),
      hookAttachment({ stdout: mine }),
    ]);
    b.userPromptSubmit(input({ sessionId: "s2", prompt: "hello", transcriptPath: both }));
    expect(deliveredRow(b)["outcome"]).toBe("delivered");
  });

  test("(e) recorded ONCE per session, across fresh processes", async () => {
    const { injection } = await woken();
    const path = writeTranscript([...PREAMBLE, hookAttachment({ stdout: injection })]);
    // Two more adapters over the same store: what a second and third hook
    // process of the same session are.
    const second = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(second.counterpart);
    second.userPromptSubmit(input({ prompt: "one", transcriptPath: path }));
    expect(second.events("adapter.wake.delivered").length).toBe(1);
    expect(readSession(dir, "s1")?.wakeChecked).toBe(true);

    const third = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(third.counterpart);
    third.userPromptSubmit(input({ prompt: "two", transcriptPath: path }));
    third.userPromptSubmit(input({ prompt: "three", transcriptPath: path }));
    expect(third.events("adapter.wake.delivered")).toEqual([]);

    // One row in the store for the session, not one per turn.
    const durable = second.counterpart.store.eventLog({ name: "adapter.wake.delivered", limit: 100 });
    expect(durable.length).toBe(1);
  });

  test("(e) the flag never invents a session record the seal is watching for", () => {
    // A session with NO record is the off→on flip (#92 review, F1). The check
    // stands down entirely rather than writing one.
    const { a } = adapter();
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: writeTranscript(PREAMBLE) }));
    expect(a.events("adapter.wake.delivered")).toEqual([]);
    expect(readSession(dir, "s1")).toBe(null);
  });

  test("(e) an observer checks nothing and writes nothing", async () => {
    const { a, injection } = await woken();
    const path = writeTranscript([...PREAMBLE, hookAttachment({ stdout: injection })]);
    const watcher = openAdapter(config({ observer: true }), { spawner: fakeSpawner().spawner });
    open.push(watcher.counterpart);
    watcher.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    expect(watcher.events("adapter.wake.delivered")).toEqual([]);
    expect(readSession(dir, "s1")?.wakeChecked).toBe(undefined);
  });

  test("(f) a malformed, absent or enormous head cannot throw and cannot blow the budget", async () => {
    const { a, injection } = await woken();
    // Not JSON at all, and bigger than the read bound several times over.
    const junk = `${"x".repeat(WAKE_HEAD_MAX_BYTES * 3)}\n`;
    const root = hostDir;
    const huge = join(root, "huge.jsonl");
    writeFileSync(huge, junk, "utf8");
    const started = performance.now();
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: huge }));
    const elapsed = performance.now() - started;
    expect(deliveredRow(a)["outcome"]).toBe("not-found");
    expect(Number(deliveredRow(a)["bytesRead"])).toBeLessThanOrEqual(WAKE_HEAD_MAX_BYTES);
    expect(elapsed).toBeLessThan(250);

    // A path the host named and nothing wrote.
    const { a: b } = await woken("s2");
    b.userPromptSubmit(input({ sessionId: "s2", prompt: "hello", transcriptPath: join(root, "nowhere.jsonl") }));
    expect(deliveredRow(b)["transcript"]).toBe("absent");
    expect(deliveredRow(b)["outcome"]).toBe("not-found");

    // A payload with no path at all, which is every hook before this shipped.
    const { a: c } = await woken("s3");
    const result = c.userPromptSubmit(input({ sessionId: "s3", prompt: "what did we settle about storage?" }));
    expect(deliveredRow(c)["outcome"]).toBe("not-found");
    // And the TURN still happened: the check never costs the recall.
    expect(result.ok).toBe(true);

    // Lines that are not JSON are COUNTED, and the attachment behind them is
    // still found (scar §2.4: nothing is silently swallowed).
    const { a: d, injection: mine } = await woken("s4");
    const mixed = join(root, "mixed.jsonl");
    writeFileSync(
      mixed,
      `{not json\n\n${"}"}\n${JSON.stringify(hookAttachment({ stdout: mine }))}\n`,
      "utf8",
    );
    d.userPromptSubmit(input({ sessionId: "s4", prompt: "hello", transcriptPath: mixed }));
    expect(deliveredRow(d)["outcome"]).toBe("delivered");
    expect(deliveredRow(d)["corrupt"]).toBe(2);
  });

  test("(f) the read is BOUNDED: an attachment past the head is not hunted for", async () => {
    const { a, injection } = await woken();
    const filler = Array.from({ length: WAKE_HEAD_MAX_LINES + 5 }, (_, i) => ({
      type: "user",
      message: { role: "user", content: `turn ${String(i)}` },
    }));
    const path = writeTranscript([...filler, hookAttachment({ stdout: injection })]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    expect(deliveredRow(a)["outcome"]).toBe("not-found");
    expect(deliveredRow(a)["linesRead"]).toBe(WAKE_HEAD_MAX_LINES);
  });

  test("(g) NO WAKE TEXT ever reaches the payload — ring or store", async () => {
    const { a, injection } = await woken();
    expect(injection).toContain("storage split");
    const path = writeTranscript([...PREAMBLE, hookAttachment({ stdout: injection })]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));

    const ring = JSON.stringify(deliveredRow(a));
    const durable = JSON.stringify(
      a.counterpart.store
        .eventLog({ name: "adapter.wake.delivered", limit: 10 })
        .map((r) => JSON.parse(r.payload ?? "{}") as unknown),
    );
    for (const dump of [ring, durable]) {
      expect(dump).not.toContain("storage split");
      expect(dump).not.toContain("counterparts:wake");
      expect(dump).not.toContain("Counterparts memory, day ");
    }
    // Numbers, booleans and short verdict words — nothing else.
    for (const [key, value] of Object.entries(deliveredRow(a))) {
      if (typeof value !== "string") continue;
      expect({ key, long: value.length > 24 }).toEqual({ key, long: false });
    }
  });

  test("(h) capture still SKIPS attachments — injected context is not conversation", () => {
    const wake = "<!-- counterparts:wake day=1 elements=1 bytes=99 -->\nwho I have been\n<!-- counterparts:wake/end day=1 identity=1 craft=0 threads=0 hints=0 horizon=0 elements=1 bytes=99 -->";
    const raw = [
      JSON.stringify(hookAttachment({ stdout: wake })),
      JSON.stringify({ type: "user", message: { role: "user", content: "hello" } }),
    ].join("\n");
    const read = parseTranscript(raw);
    expect(read.turns).toEqual([{ role: "user", text: "hello", source: "conversation", entry: 0 }]);
    expect(read.corrupt).toBe(0);
  });

  test("the reader, on a transcript head of realistic size", async () => {
    // A real morning: two other hooks on the same event, a ~9 KB wake, and a
    // megabyte of conversation after it. The check must not notice the tail.
    const { injection } = await woken();
    const chatter = Array.from({ length: 400 }, (_, i) => ({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: `${String(i)} ${"a real reply ".repeat(200)}` }] },
    }));
    const path = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ hookName: "other-a", command: "node /elsewhere/a.js", stdout: "hi" }),
      hookAttachment({ stdout: injection }),
      hookAttachment({ hookName: "other-b", command: "node /elsewhere/b.js", stdout: "hi" }),
      ...chatter,
    ]);
    const expected = injection.split("\n").slice(-1)[0] as string;
    const runs: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      const arrival = readWakeArrival(path, { expect: expected });
      runs.push(performance.now() - started);
      expect(arrival.tail.matchesExpected).toBe(true);
    }
    const slowest = Math.max(...runs);
    expect(slowest).toBeLessThan(50);
  });

  // ── the review's three fences (2026-09-17) ────────────────────────────────

  test("a host that records no `content` is `printed-unverified`, never `truncated`", async () => {
    // `content` is a field of the host's PRIVATE format, measured once. A build
    // that drops it leaves nothing to judge delivery from, and the first draft
    // read that absence as an empty injection — so every session on such a host
    // would report the one word that means v1's silent-loss bug is back.
    const { a, injection } = await woken();
    const path = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ stdout: injection, contentAbsent: true }),
    ]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));
    const row = deliveredRow(a);
    expect({
      outcome: row["outcome"],
      ok: row["ok"],
      contentRecorded: row["contentRecorded"],
      tailInStdout: row["tailInStdout"],
      tailInContent: row["tailInContent"],
    }).toEqual({
      outcome: "printed-unverified",
      ok: false,
      contentRecorded: false,
      tailInStdout: true,
      tailInContent: false,
    });

    // `content: null` is the same fact spelled differently.
    const { a: b, injection: mine } = await woken("s2");
    const nulled = writeTranscript([...PREAMBLE, hookAttachment({ stdout: mine, content: null })]);
    b.userPromptSubmit(input({ sessionId: "s2", prompt: "hello", transcriptPath: nulled }));
    expect(deliveredRow(b)["outcome"]).toBe("printed-unverified");
    expect(deliveredRow(b)["contentRecorded"]).toBe(false);

    // And an EMPTY STRING that is PRESENT still means an empty delivery: the
    // host said what it injected, and it injected nothing.
    const { a: c, injection: third } = await woken("s3");
    const empty = writeTranscript([...PREAMBLE, hookAttachment({ stdout: third, content: "" })]);
    c.userPromptSubmit(input({ sessionId: "s3", prompt: "hello", transcriptPath: empty }));
    expect(deliveredRow(c)["outcome"]).toBe("truncated");
    expect(deliveredRow(c)["contentRecorded"]).toBe(true);

    // A host that records no content AND printed a wake that is not this
    // session's is still `mismatch` — the absence widens the evidence, it does
    // not excuse it.
    const { a: d, injection: fourth } = await woken("s4");
    const lines = fourth.split("\n");
    lines[lines.length - 1] = (lines[lines.length - 1] as string).replace(/bytes=\d+ -->/, "bytes=1 -->");
    const other = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ stdout: lines.join("\n"), contentAbsent: true }),
    ]);
    d.userPromptSubmit(input({ sessionId: "s4", prompt: "hello", transcriptPath: other }));
    expect(deliveredRow(d)["outcome"]).toBe("mismatch");
  });

  test("the sentinel search is LINEAR: a body of unterminated prefixes cannot stall a turn", async () => {
    // The reviewer's probe: thousands of `<!-- counterparts:wake ` prefixes with
    // no `>` between them. Against the old unanchored `[^>]*` this backtracked
    // for 680 ms at 200 KB, four times per attachment, on the prompt path.
    //
    // MEASURED AS A RATIO, not against a wall clock (2026-09-20, finding 7).
    // This test asserted `elapsed < 100` ms, which is a claim about the machine
    // rather than about the algorithm: it failed on master whenever something
    // else was running, and an adversarial review of F5 hit it on a clean tree.
    // The property it exists to prove is growth, so growth is what it measures —
    // four times the input must cost about four times the work, not sixteen.
    //
    // Writing it this way IMMEDIATELY FAILED, and the search really was
    // quadratic: `sight()` cut its slice at the next newline, and `indexOf`
    // costs the distance it travels, so a run of unterminated prefixes made
    // every iteration scan to the far end. The cut is now `SENTINEL_MAX_BYTES`
    // alone (the anchored regexes exclude `\n` themselves, so the match is
    // identical). Measured through `readWakeArrival`, prefixes → best of 5:
    //
    //                          1000     2000     4000     8000    16000   2k→16k
    //   the newline cut       1.44ms   3.14ms   8.88ms  30.61ms  114.2ms   36.3×
    //   the bounded cut       0.93ms   1.75ms   3.13ms   6.07ms   11.9ms    6.8×
    //
    // EIGHT TIMES THE INPUT, not four: an adversarial review measured the old
    // implementation at 11.3 against a bound of 8, which is a 14 % margin and
    // too thin for the regression it guards. At 8× the two shapes separate
    // properly — linear lands near 8 (6.8 measured, the difference being fixed
    // per-call cost), quadratic near 64 (36.3 measured). The bound sits at 15,
    // with better than 2× headroom on BOTH sides, and it fails the quadratic
    // implementation by a factor of two and a half.
    const { injection } = await woken();
    const expected = injection.split("\n").slice(-1)[0] as string;
    const poisoned = (prefixes: number): string => {
      const poison = `${"<!-- counterparts:wake ".repeat(prefixes)}${injection}`;
      return writeTranscript([...PREAMBLE, hookAttachment({ stdout: poison, content: poison })]);
    };
    // The read bound is 256 KiB on the live path; this probe raises it so the
    // whole poisoned attachment is actually scanned — the reviewer's 200 KB at
    // the size the bound would allow, rather than a line the reader drops.
    const read = (path: string): number => {
      const started = performance.now();
      const arrival = readWakeArrival(path, { expect: expected, maxBytes: 4 * 1024 * 1024 });
      const elapsed = performance.now() - started;
      // And the real sentinel is still the answer: a match that IS the
      // expectation beats an earlier one that is not.
      expect(arrival.tail.matchesExpected).toBe(true);
      return elapsed;
    };
    // THE MINIMUM OF SEVERAL RUNS, after a warm-up. A scheduler can only ever
    // make a run slower, so the fastest of N is the closest this can get to the
    // work actually done; an average would carry whatever else the machine did.
    const best = (path: string): number => {
      let min = Infinity;
      for (let i = 0; i < 5; i += 1) min = Math.min(min, read(path));
      return min;
    };
    const smallPath = poisoned(2000);
    const bigPath = poisoned(16000);
    read(smallPath); // warm up: first-touch page faults are not the algorithm
    const small = best(smallPath);
    const big = best(bigPath);
    const ratio = big / Math.max(small, 0.001);
    // The ratio rides on the failure message, so a break says what it measured
    // rather than only that a boolean was wrong.
    expect({ quadratic: ratio >= 15, ratio: Number(ratio.toFixed(1)) }).toMatchObject({
      quadratic: false,
    });
    // A second, deliberately generous guard, so a search that went linear-but-
    // catastrophic (an accidental whole-file read per prefix) still fails. The
    // quadratic implementation measured 114 ms at this size.
    expect(big).toBeLessThan(4000);
  });

  test("no string from the wake body can reach a payload, a session record or an error", async () => {
    // The poison case: a memory body that opens a sentinel it never closes, so
    // the old matcher swallowed everything up to the real one and returned it
    // on `SentinelSighting.line`.
    const { a, injection } = await woken();
    const secret = "THE OWNERS SECRET MEMORY TEXT LIVES HERE AND HAS NO ANGLE BRACKET";
    const poisoned = `<!-- counterparts:wake ${secret} ${injection}`;
    const path = writeTranscript([
      ...PREAMBLE,
      hookAttachment({ stdout: poisoned, content: poisoned }),
    ]);
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: path }));

    const expected = injection.split("\n").slice(-1)[0] as string;
    const arrival = readWakeArrival(path, { expect: expected });
    const durable = JSON.stringify(
      a.counterpart.store
        .eventLog({ name: "adapter.wake.delivered", limit: 10 })
        .map((r) => JSON.parse(r.payload ?? "{}") as unknown),
    );
    const record = JSON.stringify(readSession(dir, "s1"));
    // NOTHING from the body reaches any of them — payload, ring, session record
    // or the adapter's own error events.
    for (const dump of [JSON.stringify(arrival), JSON.stringify(deliveredRow(a)), durable, record, JSON.stringify(a.events()), JSON.stringify(a.counterpart.events())]) {
      expect(dump).not.toContain(secret);
    }
    // And no sentinel-shaped string reaches a payload at all. The session
    // record is the one place a sentinel legitimately lives — it is the one we
    // PRINTED, written there for the next process, and it is that exactly.
    for (const dump of [JSON.stringify(arrival), JSON.stringify(deliveredRow(a)), durable]) {
      expect(dump).not.toContain("counterparts:wake");
    }
    expect(readSession(dir, "s1")?.wakeSentinel).toBe(expected);
    // The sighting is numbers and flags — no string field at all.
    for (const value of Object.values(arrival.tail)) {
      expect(typeof value === "string").toBe(false);
    }
  });

  test("a transcript path that is not a REGULAR FILE is refused, never opened", async () => {
    const { a } = await woken();
    // A directory: `existsSync` says yes, and an open would have to fail
    // somewhere — it fails here, cheaply, with a reason.
    a.userPromptSubmit(input({ prompt: "hello", transcriptPath: hostDir }));
    expect(deliveredRow(a)["transcript"]).toBe("unreadable");

    // A FIFO: `openSync` on one BLOCKS until a writer arrives, which would hang
    // the prompt until the host's own hook timeout. Nothing opens it.
    const fifo = join(hostDir, "transcript.fifo");
    const made = Bun.spawnSync(["mkfifo", fifo]);
    if (made.exitCode === 0) {
      const started = performance.now();
      const arrival = readWakeArrival(fifo);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(arrival.reason).toBe("unreadable");
    }
  }, 10_000);
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

  test("a turn that recalls something carries the local time above the note, outside it", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "the storage split and canonical prose in markdown files" }));
    expect(result.injection.length).toBeGreaterThan(0);
    const note = withoutNow(result.injection);
    // The note's own accounting is untouched by the line above it.
    expect(Buffer.byteLength(note, "utf8")).toBe(result.bytes);
  });

  test("the clock line is the STORE's zone at the adapter's instant", () => {
    const { spawner } = fakeSpawner();
    const at = Date.parse("2026-09-26T05:50:00Z"); // 23:50 MDT on the 25th
    const a = openAdapter(config({ timeZone: "America/Denver" }), {
      command: "/bin/true",
      args: ["runner"],
      spawner,
      now: () => at,
    });
    open.push(a.counterpart);
    expect(a.counterpart.store.zone()).toBe("America/Denver");
    const woke = a.sessionStart(input());
    expect(woke.injection.split("\n")[0]).toBe("Now: Fri 25 Sep 2026, 11:50 pm MDT");
  });

  test("a quiet turn injects the clock line alone, never an empty block", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "zygomorphic vellichor quixotry" }));
    // Every turn carries the time since 2026-09-25 (docs/time.md rule 5).
    expect(result.injection).toMatch(/^Now: [^\n]+$/);
    expect(result.bytes).toBe(0);
    expect(result.ok).toBe(true);
  });

  test("an empty prompt is a quiet hook, not a failure", () => {
    const { a } = seeded();
    const result = a.userPromptSubmit(input({ prompt: "   " }));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("empty-prompt");
    expect(result.injection).toMatch(/^Now: [^\n]+$/);
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
    live(a);
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
    live(a);
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
    live(a);
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
    live(a);
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

  test("a refusal is DURABLE once per reason per date, and the count survives the process (I32)", () => {
    // TWO adapter instances over one store, because that is the shape of the
    // bug: a hook is a fresh process, so a counter living in adapter state was
    // always at 1 and `escalate` was always false. On the live host the worker
    // was refused at every boundary for a week and E4's widening never fired.
    const { a } = adapter();
    const refusing = (): ClaudeCodeAdapter =>
      new ClaudeCodeAdapter({
        counterpart: a.counterpart,
        // The store is real; the SPAWN's data dir is the thing that is missing.
        config: config({ dataDir: "" }),
        spawner: fakeSpawner().spawner,
      });

    const first = refusing();
    let last = first.stop(input({ sessionId: "no-dir-1" })).spawn;
    expect({ started: last?.started, reason: last?.reason, escalate: last?.escalate }).toEqual({
      started: false,
      reason: "NO_DATA_DIR",
      escalate: false,
    });
    for (let i = 2; i < TUNABLES.ESCALATE_AFTER; i += 1) {
      last = first.stop(input({ sessionId: `no-dir-${i}` })).spawn;
    }
    expect(last?.escalate).toBe(false);

    // A SECOND instance — a new hook process, as far as the counter is
    // concerned — reaches the threshold, because the count is in the store.
    const second = refusing();
    last = second.stop(input({ sessionId: "no-dir-next" })).spawn;
    expect(last?.escalate).toBe(true);
    expect(second.spawnRefusals()["NO_DATA_DIR"]).toBe(TUNABLES.ESCALATE_AFTER);
    expect(a.counterpart.store.getMeta(`${SPAWN_REFUSAL_PREFIX}NO_DATA_DIR`)).toBe(
      String(TUNABLES.ESCALATE_AFTER),
    );

    // ONE ROW, for ESCALATE_AFTER refusals of one reason on one date. The row
    // is the evidence that it happened; the counter is how deep it got.
    const rows = a.counterpart.store
      .eventLog({ name: SPAWN_REFUSED_EVENT, limit: 20 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect({ reason: rows[0]?.["reason"], date: rows[0]?.["date"], count: rows[0]?.["count"] }).toEqual({
      reason: "NO_DATA_DIR",
      date: "2026-01-02",
      count: 1,
    });
    // A different DATE is a different row: a refusal that runs for a week is
    // seven rows, not one and not seven hundred.
    second.stop(input({ sessionId: "no-dir-tomorrow", at: "2026-01-03" }));
    expect(a.counterpart.store.eventLog({ name: SPAWN_REFUSED_EVENT, limit: 20 }).length).toBe(2);

    // And a start clears the slate — whatever was wrong is not wrong now.
    a.stop(input({ sessionId: "healthy" }));
    expect(a.spawnRefusals()["NO_DATA_DIR"] ?? 0).toBe(0);
  });

  test("a worker that DID start leaves one row per date, with the day's count (E2)", () => {
    // The other half of I32. Until 2026-09-20 a healthy start wrote nothing, so
    // a worker dead all week and a week with nothing to do left the same
    // nothing and `fired` could only call the mechanism blind.
    const { a } = adapter();
    const store = a.counterpart.store;
    const rows = (): Record<string, unknown>[] =>
      store
        .eventLog({ name: SPAWN_STARTED_EVENT, limit: 20 })
        .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);

    a.stop(input({ sessionId: "one" }));
    a.stop(input({ sessionId: "two" }));
    a.stop(input({ sessionId: "three" }));
    // ONE ROW for three boundaries on one date — a boundary is a hot path and
    // three hundred identical rows a day would drown the log this feeds.
    expect(rows().length).toBe(1);
    // THE ROW CARRIES NO COUNT. The latch means only the day's FIRST start ever
    // writes, so any tally on the row would read `1` forever — a number that
    // looks like a measurement and is an artefact of the latch. The day's real
    // tally is in the meta counters, where doctor's Spawn line reads it.
    expect(rows()[0]?.["date"]).toBe("2026-01-02");
    expect("count" in (rows()[0] ?? {})).toBe(false);
    expect(store.getMeta(SPAWN_START_COUNT_KEY)).toBe("3");
    expect(a.spawnStarts()).toEqual({ date: "2026-01-02", count: 3 });
    expect(store.getMeta(SPAWN_START_DATE_KEY)).toBe("2026-01-02");

    // A new date is a new row, and the day's tally starts over rather than
    // accumulating for the life of the store.
    a.stop(input({ sessionId: "four", at: "2026-01-03" }));
    expect(rows().length).toBe(2);
    expect(store.getMeta(SPAWN_START_COUNT_KEY)).toBe("1");

    // AN OBSERVER WRITES NEITHER THE ROW NOR THE COUNTER — and the stance that
    // decides it is the COUNTERPART'S, not the config's (`hooks.ts`:
    // `this.observer = opts.counterpart.observer`). Asserted, because an
    // adapter built over a writer counterpart with `observer: true` in its
    // config is NOT an observer, and a test that assumed it was would pass for
    // a reason that has nothing to do with the guard under test.
    const watcher = new ClaudeCodeAdapter({
      counterpart: observerCounterpart(),
      config: config({ observer: true }),
      spawner: fakeSpawner().spawner,
    });
    expect(watcher.observer).toBe(true);
    watcher.stop(input({ sessionId: "watching", at: "2026-01-04" }));
    expect(rows().length).toBe(2);
    expect(store.getMeta(SPAWN_START_COUNT_KEY)).toBe("1");
  });

  test("NO clock can cap an ask any more — the day counter is gone (I32, closed 2026-09-17)", () => {
    const { a } = adapter();
    const store = a.counterpart.store;
    // The live store's exact shape on 2026-09-11: the worker had not run since
    // 09-04, so the lived-day clock sat at one number while the calendar moved,
    // and that day's ask counter was at its cap and could never be reset —
    // because only the sleep cycle the worker runs advances the clock. Keying
    // the cap to the calendar date fixed the freeze; moving it onto the SESSION
    // (2026-09-17) retired the counter, so there is no longer a number any
    // clock, stuck or moving, can spend on a session's behalf.
    const stuck = store.livedDay();
    const stuckKey = `self.episode.day.${String(stuck)}`;
    store.setMeta(stuckKey, "99");
    store.setMeta("self.episode.day.2026-03-09", "99");

    const result = a.stop(input({ sessionId: "s-new-day", turns: BIG_TURNS, at: "2026-03-09" }));
    expect(result.ask).not.toBe(null);
    // NEITHER key is read, and neither is written: nothing counts asks by day.
    expect(store.getMeta(stuckKey)).toBe("99");
    expect(store.getMeta("self.episode.day.2026-03-09")).toBe("99");

    // "How often was the pen offered today" is a question the DURABLE rows
    // answer — each stamped with the host's date — and no longer one the cap
    // asks. `capped` is what 27 Stops read on the live store while the model was
    // never actually asked.
    const rows = store
      .eventLog({ name: "adapter.ask", limit: 5 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.at(-1)?.["outcome"]).toBe("asked");
    expect(rows.at(-1)?.["date"]).toBe("2026-03-09");
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

describe("the runner — the day runs, and the sweep never makes a model call", () => {
  test("every session-ending path CAPTURES, and the worker's sweep reads none of it — even once a session crashes", async () => {
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
      live(a, `s-${hook}`);
      const result = a.hook(hook as HookName, input({ sessionId: `s-${hook}`, turns: turnsFor(hook) }));
      expect({ hook, ok: result.ok, appended: result.spansAppended > 0 }).toEqual({ hook, ok: true, appended: true });
    }
    // Stop and SessionEnd spawn the worker; that is unchanged and load-bearing.
    expect(calls.length).toBe(2);
    a.counterpart.close();
    open.length = 0;

    // The worker runs. Nothing has crashed — every session's last boundary is
    // seconds old.
    const quiet = await runOnce({ config: config(), date: "2026-01-02" });
    expect({ ran: quiet.ran, swept: quiet.swept, minted: quiet.minted }).toEqual({
      ran: true,
      swept: 0,
      minted: 0,
    });

    // Now the two sessions that never reached `session-end` go quiet. They are
    // crashed — and the worker STILL reads none of it (keyless, 2026-09-24): a
    // session that ended before it was written up is the next session's to
    // write up, so its words stay where the write-up reads them.
    goQuiet();
    const later = await runOnce({ config: config(), date: "2026-01-03" });
    expect({ ran: later.ran, swept: later.swept, minted: later.minted }).toEqual({
      ran: true,
      swept: 0,
      minted: 0,
    });

    // The gate's own durable row, both runs, so the daily can tell a quiet
    // sweep from a broken one.
    const after = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(after.counterpart);
    expect(after.counterpart.spans.spans("proj").length).toBeGreaterThan(0);
    const rows = after.counterpart.store
      .eventLog({ name: SWEEP_GATE_EVENT, limit: 10 })
      .map((row) => JSON.parse(row.payload ?? "{}") as Record<string, unknown>);
    expect(rows.map((r) => r["reason"])).toEqual(["not-opted-in", "not-opted-in"]);
    // Self-attributing: the row carries the calendar date the run belonged to,
    // so a reader does not have to infer it from the lived-day column.
    expect([rows[0]?.["date"], rows[1]?.["date"]]).toEqual(["2026-01-02", "2026-01-03"]);
  });

  test("the worker runs the day with no model call, and the gate row says why it did not sweep", async () => {
    // I32, pinned. For a week this worker never started at all, so the lived-day
    // clock froze at 185, the sleep cycle never ran, and the per-lived-day ask
    // cap — spent under that frozen day — was never reset. None of that needs a
    // model call, and since 2026-09-24 nothing the worker does needs one.
    const { a } = adapter();
    a.stop(input());
    const before = a.counterpart.store.livedDay();
    a.counterpart.close();
    open.length = 0;
    goQuiet();

    const realFetch = globalThis.fetch;
    let sockets = 0;
    (globalThis as { fetch: unknown }).fetch = (): never => {
      sockets += 1;
      throw new Error("the worker opened a socket");
    };
    let report;
    try {
      report = await runOnce({ config: config(), date: "2026-01-03" });
    } finally {
      (globalThis as { fetch: unknown }).fetch = realFetch;
    }
    expect(sockets).toBe(0);
    expect({ ran: report.ran, reason: report.reason }).toEqual({ ran: true, reason: "ran" });

    const after = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(after.counterpart);
    // THE DAY HAPPENED: the clock moved and the cycle ran.
    expect(after.counterpart.store.livedDay()).toBeGreaterThan(before);
    expect(after.counterpart.store.getMeta("lastActiveDate")).toBe("2026-01-03");
    // And the one step that did not is EVIDENCED, by name, on a durable row
    // whose counts read as a quiet day rather than as a suspicious one.
    const rows = after.counterpart.store
      .eventLog({ name: SWEEP_GATE_EVENT, limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect({
      reason: rows[0]?.["reason"],
      ran: rows[0]?.["ran"],
      scopes: rows[0]?.["scopes"],
      otherRefusals: rows[0]?.["otherRefusals"],
      date: rows[0]?.["date"],
    // `not-opted-in`: the worker never interprets (keyless since 2026-09-24).
    }).toEqual({ reason: "not-opted-in", ran: 0, scopes: 0, otherRefusals: 0, date: "2026-01-03" });
  });

  test("a sessionEnd that THROWS leaves a durable adapter.runner.failed row (I32)", async () => {
    const { a } = adapter();
    a.stop(input());
    a.counterpart.close();
    open.length = 0;

    // Past the store's own door, so the parent's spawn row does not cover it:
    // this is the half of the worker that only a row written from inside can
    // report, because the process's stderr goes nowhere (stdio: ignore).
    const spy = spyOn(Counterpart.prototype, "sessionEnd").mockImplementation(() => {
      throw Object.assign(new Error("the boundary fell over"), { code: "TEST_BOUNDARY" });
    });
    try {
      const report = await runOnce({ config: config(), date: "2026-01-02" });
      expect({ ran: report.ran, reason: report.reason, code: report.code }).toEqual({
        ran: false,
        reason: "failed",
        code: "TEST_BOUNDARY",
      });
    } finally {
      spy.mockRestore();
    }

    const after = openAdapter(config(), { spawner: fakeSpawner().spawner });
    open.push(after.counterpart);
    const rows = after.counterpart.store
      .eventLog({ name: RUNNER_FAILED_EVENT, limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.length).toBe(1);
    expect({ code: rows[0]?.["code"], step: rows[0]?.["step"] }).toEqual({
      code: "TEST_BOUNDARY",
      step: "sessionEnd",
    });
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

});

// ═══════════════════════════════════════════════════════════════════════════
// Configuration, capabilities, transcript reading
// ═══════════════════════════════════════════════════════════════════════════
describe("configuration — reported, checkable, and failing toward standing down", () => {
  test("an UNREADABLE configuration resolves to OBSERVER, never to 'encode anyway'", () => {
    expect(loadConfig({ injectionBudgetBytes: "nine thousand" }).config.observer).toBe(true);
    expect(loadConfig("not an object").reason).toBe("unreadable");
    expect(loadConfig({ owner: "yes" }).config.observer).toBe(true);
    // A setting this build no longer reads is NOT unreadable: it is ignored and
    // named (keyless, 2026-09-24).
    expect(loadConfig({ models: { interpret: { id: 7 } } }).config.observer).toBeUndefined();
    // An ABSENT configuration is ordinary, and is not a stand-down.
    expect(loadConfig(undefined).config.observer).toBeUndefined();
    expect(loadConfig(undefined).ok).toBe(true);
  });

  test("a good configuration round-trips, and unknown fields do not smuggle a stance", () => {
    const loaded = loadConfig({
      dataDir: "/tmp/x",
      injectionBudgetBytes: 9000,
      owner: true,
      identity: { name: "Mike", aliases: ["mike"] },
      somethingElse: 42,
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.config.injectionBudgetBytes).toBe(9000);
    expect(loaded.config.identity?.name).toBe("Mike");
    expect(loaded.config.observer).toBeUndefined();
  });

  test("every host-dependent limit has a row, and 'we never asked' is visible", () => {
    const rows = capabilities({});
    // No credential row since 2026-09-24: the package reads no key.
    expect(rows.map((r) => r.name).sort()).toEqual([
      "executionCeilingMs",
      "injectionBudgetBytes",
      "socketLifetimeMs",
    ]);
    for (const row of rows) {
      expect({ name: row.name, reported: row.reported }).toEqual({ name: row.name, reported: false });
    }
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
    const result = a.userPromptSubmit(input({ prompt: "what did we settle about storage?" }));
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
    live(a);
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
    a.userPromptSubmit(input({ prompt: "what about storage?" }));
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
    live(a);
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
    live(a);
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
    // `substanceOf` counts the person's `conversation` only: the pure peer turn
    // and the ritual turn are out, the mixed turn is in (the owner did speak),
    // and the assistant's reply adds bytes but never a turn.
    expect(substanceOf(read.turns).turns).toBe(2);
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

    // THE TOTALITY: no canonical byte anywhere in the store holds the secret.
    //
    // It used to walk `prose/`. Since the floor the canonical bytes are the
    // database's, so the walk is the whole store directory, read as BYTES —
    // a `readFileSync(_, "utf8")` over a SQLite file replaces invalid sequences
    // and could pull the credential apart, passing for the wrong reason. The
    // `-wal` is included deliberately: a redaction that landed in the database
    // while the raw text sat in the log would be the gap this test exists for.
    const files: string[] = [];
    const walk = (root: string): void => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(readFileSync(full).toString("latin1"));
      }
    };
    walk(dir);
    const bytes = files.join("\n");
    // Non-vacuous from two sides: there ARE memories in this store (the three
    // deposits above), and their words really are in these bytes.
    expect(c.store.list().length).toBeGreaterThan(0);
    expect(bytes).toContain("is the one to rotate this quarter");
    expect(bytes).not.toContain(CREDENTIAL);
  });
});

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

/**
 * A local embedder over `vectorFor`, in the `LiveEmbedder` shape the adapter
 * wires: the sync face answers from what the live half computed, and counts
 * its misses; `calls` counts every ask of the live half. No network anywhere.
 */
function cachedEmbedder(opts: { dead?: boolean } = {}): LiveEmbedder & { calls: string[][] } {
  const calls: string[][] = [];
  const cache = new Map<string, number[]>();
  let misses = 0;
  const fill = (texts: readonly string[]): number => {
    calls.push([...texts]);
    if (opts.dead === true) return 0;
    for (const t of texts) cache.set(t, vectorFor(t));
    return texts.length;
  };
  return {
    calls,
    model: "test-embed-1",
    embed: (t: string) => {
      const hit = cache.get(t);
      if (hit === undefined) misses += 1;
      return hit ?? null;
    },
    vector: async (t: string) => {
      fill([t]);
      return cache.get(t) ?? null;
    },
    warm: async (texts: readonly string[]) => fill(texts),
    stats: () => ({ hits: 0, misses, cached: cache.size, fetched: 0, failed: 0, lastFailures: [] }),
  };
}

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

describe("the embedder knob — honoured by both composition roots", () => {
  test("without the knob NO embedder exists", async () => {
    expect(openEmbedder(config())).toBe(null);
    expect(openEmbedder(config({ embedder: { enabled: false } }))).toBe(null);
    // Switched on, but the session is an INSTRUMENT: an instrument computes no
    // vectors (docs/observer-mode.md, scar E7).
    expect(openEmbedder(config({ embedder: { enabled: true }, observer: true }))).toBe(null);
    expect(openEmbedder(config({ embedder: { enabled: true } }))).not.toBe(null);

    // And the whole adapter path: a deposit with the knob off embeds nothing.
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
    const loaded = loadConfig({ embedder: { enabled: true } });
    expect(loaded.ok).toBe(true);
    expect(loaded.config.embedder).toEqual({ enabled: true });

    // An unreadable egress knob fails toward STANDING DOWN, never toward "on".
    const bad = loadConfig({ embedder: { enabled: "yes" } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unreadable");
    expect(bad.config).toEqual({ observer: true });
  });
});

describe("novelty stops being null — the authored door measures prediction error", () => {
  test("the FIRST deposit is blind for lack of CONTEXT, not for lack of a vector", async () => {
    const embedder = cachedEmbedder();
    const { calls } = embedder;
    const { spawner } = fakeSpawner();
    const a = openAdapter(config({ embedder: { enabled: true } }), {
      command: "/bin/true",
      args: ["runner"],
      spawner,
      embedder,
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

  test("a deposit whose embedding FAILS still lands — blind, and countably so", async () => {
    const { spawner } = fakeSpawner();
    const a = openAdapter(config({ embedder: { enabled: true } }), {
      command: "/bin/true",
      args: ["runner"],
      spawner,
      embedder: cachedEmbedder({ dead: true }),
    });
    open.push(a.counterpart);

    const out = await a.counterpart.submitSessionEnd(
      { content: "A memory made while the embedder was answering nothing all afternoon.", kind: "fact" },
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
    // ONE object for the sync face and the live half, as the production wiring
    // uses — not two fakes agreeing with each other.
    const live = cachedEmbedder();
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

  test("an OBSERVER embeds nothing at all — the stand-down is structural", async () => {
    const vectors = cachedEmbedder();
    // An observer refuses to open a store that does not exist yet, so the dir is
    // initialized by an ordinary session first — as it would be in life.
    Counterpart.open({ dir }).close();

    const c = Counterpart.open({
      dir,
      observer: true,
      embed: (t: string) => vectorFor(t),
      vectors,
    });
    open.push(c);
    await c.submitSessionEnd(
      { content: "An instrument's deposit, which deposits nothing and embeds nothing.", kind: "fact" },
      { session: "s1", scope: "proj" },
    );
    expect(vectors.calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Keyless (owner, 2026-09-24): no key is read, no model API is called
// ═══════════════════════════════════════════════════════════════════════════
describe("keyless — no key is read, and an old configuration's key settings are ignored", () => {
  let host: string;
  beforeEach(() => {
    host = mkdtempSync(join(tmpdir(), "counterparts-keyless-"));
  });
  afterEach(() => {
    rmSync(host, { recursive: true, force: true });
  });

  test("THE DAY-0 FAILURE, pinned: an empty hook environment still STARTS the worker (I32)", () => {
    // What the host actually hands a hook process: none of the owner's shell.
    // Until 2026-09-11 a missing key REFUSED the spawn, and that refusal is what
    // I32 is; since 2026-09-24 there is no key to miss.
    const cfg = join(host, "claude-code.json");
    writeFileSync(cfg, JSON.stringify({ dataDir: dir, owner: true }));
    const { config: c } = hostConfig(cfg);
    const plan = planSpawn({ config: c, command: "/bin/true", args: [], baseEnv: {} });
    expect(plan.ok).toBe(true);
    expect(plan.reason).toBe("ready");
    expect(plan.env[DATA_DIR_ENV]).toBe(dir);
  });

  test("a `credentialsFile` in the configuration is IGNORED: read, not refused, named as retired, and the file is never opened", () => {
    // The owner's own live configuration carries this key from the install that
    // wrote it. It must cost nothing — not a stand-down, not a read of the file.
    const creds = join(host, "credentials.env");
    writeFileSync(creds, "ANTHROPIC_" + "API_KEY=sk-ant-DAY0-TOKEN\n");
    const before = statSync(creds).atimeMs;
    const cfg = join(host, "claude-code.json");
    writeFileSync(cfg, JSON.stringify({ dataDir: dir, owner: true, credentialsFile: creds }));
    const { config: c, reason } = hostConfig(cfg);
    expect(reason).toBe("loaded");
    expect(c.observer).toBeUndefined();
    expect(c.dataDir).toBe(dir);
    expect((c.retired ?? []).join(" ")).toContain('"credentialsFile" is no longer used');
    expect("credentialsFile" in c).toBe(false);
    // The runner reads the same file the same way, and the PIN still wins.
    const pinned = join(dir, "pinned");
    const r = runnerConfig(cfg, { [DATA_DIR_ENV]: pinned });
    expect(r.config.dataDir).toBe(pinned);
    expect(r.config.observer).toBeUndefined();
    expect(statSync(creds).atimeMs).toBe(before);
    // And no process environment was filled from it.
    expect(process.env["ANTHROPIC_" + "API_KEY"] === "sk-ant-DAY0-TOKEN").toBe(false);
  });

  test("the shipped source reaches no model API and reads no key", () => {
    // The owner's line, mechanized: "no keys; nothing leaves your machine except
    // through Claude Code". Every TypeScript file under src/, comments included.
    const root = fileURLToPath(new URL("../src/", import.meta.url));
    const forbidden = [
      "api." + "anthropic.com",
      "api." + "voyageai.com",
      "ANTHROPIC_" + "API_KEY",
      "VOYAGE_" + "API_KEY",
    ];
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          const text = readFileSync(p, "utf8");
          for (const word of forbidden) if (text.includes(word)) hits.push(`${p}: ${word}`);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the host's ask channel — stderr + exit 2 on Stop from day 0 (2026-09-03); Stop additionalContext since 2026-09-24", () => {
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
      dropped: null,
    });
    expect(hostDelivery("user-prompt-submit", R({ injection: "recall" }), {}).exitCode).toBe(0);
  });

  test("a Stop with an ask CONTINUES the turn by the non-error route (2026-09-24): Stop additionalContext on stdout, exit 0, nothing on stderr", () => {
    const d = hostDelivery("stop", R({ ask: "Write what you learned, and the episode." }), {});
    expect(d.exitCode).toBe(0);
    expect(d.stderr).toBe("");
    expect(JSON.parse(d.stdout)).toEqual({
      systemMessage: STOP_HUMAN_LINE,
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: "Write what you learned, and the episode." },
    });
  });

  test("a Stop with nothing to ask exits 0 and prints nothing", () => {
    expect(hostDelivery("stop", R({}), {})).toEqual({ stdout: "", stderr: "", exitCode: 0, dropped: null });
  });

  test("the host's re-fired Stop (`stop_hook_active`) asks NOTHING — the anti-loop v1 carries for the same reason", () => {
    const d = hostDelivery("stop", R({ ask: "Write what you learned." }), { stop_hook_active: true });
    expect(d).toEqual({ stdout: "", stderr: "", exitCode: 0, dropped: null });
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
    // REASK_TURNS more typed messages since the ask, short ones: asked again.
    const more = Array.from({ length: SELF_TUNABLES.REASK_TURNS * 2 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i}: a genuinely new line of conversation.`,
    }));
    const third = a.stop(input({ turns: [...(BIG_TURNS ?? []), ...more] }));
    // Still chapter 1: nothing was written, so nothing was numbered.
    expect(third.ask).toBe(stopAsk("s1", 1));
  });

  test("EVERY session on a day is asked — no session spends another's allowance", () => {
    // Finding 12, in one test: the cap used to be four asks shared by every
    // session a calendar day held, and the owner runs five or more a day, so
    // 196 of 264 Stops were refused before their session had said a word.
    const { a } = adapter();
    for (let i = 0; i < 6; i += 1) {
      expect(a.stop(input({ sessionId: `s-day-${String(i)}`, turns: BIG_TURNS })).ask).not.toBeNull();
    }
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.map((r) => r["outcome"])).toEqual(Array.from({ length: 6 }, () => "asked"));
    // A session with nothing in it is still refused, on substance: what a day
    // no longer does is refuse for it.
    const thin = a.stop(input({ sessionId: "s-thin", turns: TURNS }));
    expect(thin.ask).toBeNull();
    const last = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>)
      .at(-1);
    expect(last?.["outcome"]).toBe("paced");
    expect(last?.["reason"]).toBe("not-enough-substance");
  });

  test("ONE session is capped at MAX_ASKS_PER_SESSION, and the row still reads `capped`", () => {
    // The backstop, reached only by a session that keeps earning asks: each one
    // past the first needs REASK_TURNS more typed turns (or REASK_TEXT_BYTES).
    const { a } = adapter();
    const turns = [...(BIG_TURNS ?? [])];
    const outcomes: (string | null)[] = [];
    for (let ask = 0; ask < SELF_TUNABLES.MAX_ASKS_PER_SESSION + 1; ask += 1) {
      outcomes.push(a.stop(input({ sessionId: "s-long", turns })).ask);
      turns.push(
        ...Array.from({ length: SELF_TUNABLES.REASK_TURNS * 2 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          text: `Stretch ${String(ask)}.${String(i)}: another new line of the same conversation.`,
        })),
      );
    }
    // Asked every time the substance was there — until the count ran out.
    expect(outcomes.slice(0, SELF_TUNABLES.MAX_ASKS_PER_SESSION).every((o) => o !== null)).toBe(true);
    expect(outcomes.at(-1)).toBeNull();
    const rows = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 100 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    // The outcome vocabulary is unchanged — `asked` | `paced` | `capped`.
    expect(rows.at(-1)?.["outcome"]).toBe("capped");
    expect(rows.at(-1)?.["reason"]).toBe("session-ask-cap");
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
    // A session that IS inside the memory first — a record and a cursor — so
    // that what this test breaks is the registry and nothing else. (Since the
    // retroactive-capture guard, a boundary whose session has neither of those
    // seals the stretch rather than capturing it, which is a different rule
    // with its own tests.)
    a.sessionStart(input());
    a.stop(input());
    rmSync(join(dir, "sessions"), { recursive: true, force: true });
    // The registry path is now a FILE: every write below fails at the filesystem.
    writeFileSync(join(dir, "sessions"), "not a directory", "utf8");
    try {
      const stopped = a.stop(
        input({
          turns: [
            ...TURNS,
            { role: "user", text: "One more decision after the registry broke, and it still has to land." },
          ],
        }),
      );
      expect(stopped.ok).toBe(true);
      expect(stopped.spansAppended).toBeGreaterThan(0);
      expect(a.events("adapter.session.registry").at(-1)?.data).toEqual({
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
    expect(text).toContain("session_end tool");
    // The chapter door, which did not exist for the fortnight the ask named it.
    expect(text).toContain("chapter tool");
  });

  test("`updates` and salience are the TOOL's to explain now, and it does (B1)", () => {
    // Four notes on the live host arrived as "updates: mem_x. …" in their own
    // body text, unlinked, because the old ask said "say `updates: <id>`". The
    // ask no longer mentions either field; the description the model reads
    // while filling them does, and must keep doing so.
    const text = stopAsk("s1", 1);
    expect(text).not.toContain("updates");
    expect(text).not.toContain("salience");
    const spec = JSON.stringify(toolSpec("session_end"));
    expect(spec).toContain("`updates` is a FIELD on an entry, not prose");
    expect(spec).toContain("A salience you claim is a floor");
    expect(spec).toContain("An entry that claims no salience gets an ordinary default floor");
  });

  test("it keeps the sentence that sanctions an honest no, and names the empty answer", () => {
    const text = stopAsk("s1", 2);
    expect(text).toContain("Nothing worth keeping is a real answer");
    expect(text).toContain("`memories: []`");
  });

  test("the chapter it asks for names its NUMBER, and the number is the store's", () => {
    expect(stopAsk("s1", 3)).toContain("Write chapter 3 of");
    expect(stopAsk("s1", 1)).toContain("Write chapter 1 of");
  });

  test("it stays short — two lines, a model reads this at every Stop that is due one", () => {
    const text = stopAsk("7c973b1c-d40a-47e5-92bb-8cdb1823a06d", 1);
    // B1 (2026-09-23): nine lines and ~1,250 characters became two lines, and
    // the bound came down with it (was 1,300). The words themselves are pinned
    // in `test/stop-ask-quiet.test.ts`.
    expect(text.split("\n").length).toBe(2);
    expect(text.length).toBeLessThanOrEqual(450);
  });

  test("the handoff is a FIELD on the call item 1 already names — not a third tool", () => {
    // §13 G3's scar is that the blocked moment carries a SINGLE ask. A field is
    // not an ask: there is one pacer (`askAtStop` → `episodeAsk`), one text, and
    // the handoff names no tool of its own.
    const text = stopAsk("7c973b1c-d40a-47e5-92bb-8cdb1823a06d", 1);
    expect(text).toContain("set `handoff` on it only if work here is unfinished");
    // Exactly two numbered items, and no third tool named.
    expect(text.match(/(^|: )\d\) /gm)?.length).toBe(2);
    expect(text).not.toContain("handoff tool");
  });

  test("the re-fired Stop still asks NOTHING — the anti-loop is untouched", () => {
    const d = hostDelivery(
      "stop",
      { injection: "", ask: stopAsk("s1", 1) },
      { stop_hook_active: true },
    );
    expect(d).toEqual({ stdout: "", stderr: "", exitCode: 0, dropped: null });
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
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0, lastFailures: [] }),
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
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 0, failed: 0, lastFailures: [] }),
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
    await backfillVectors({ counterpart: c, embedder: emb });

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
    await backfillVectors({ counterpart: c, embedder: emb });

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

  test("an embedder that answers nothing is `embed-failed`, and an absent one `embedder-off`", async () => {
    const c = brain(null);
    seed(c);
    c.captureSpans({
      session: "s-dead",
      scope: "proj",
      turns: [{ role: "user", text: "Anything about the kite festival?" }],
    });
    expect(
      (await laggedSemantic({ counterpart: c, sessionId: "s-dead", scope: "proj", embedder: null }))
        .reason,
    ).toBe("embedder-off");
    expect(
      (
        await laggedSemantic({
          counterpart: c,
          sessionId: "s-dead",
          scope: "proj",
          embedder: deadEmbedder(),
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
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0, lastFailures: [] }),
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

    const report = await backfillVectors({ counterpart: c, embedder: emb, limit: 2 });
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

    const rest = await backfillVectors({ counterpart: c, embedder: emb });
    expect(rest.embedded).toBe(3);
    expect(rest.remaining).toBe(0);
    expect((await backfillVectors({ counterpart: c, embedder: emb })).reason).toBe(
      "nothing-missing",
    );
  });

  test("the counts are DURABLE — a coverage watch reads them out of the store tomorrow", async () => {
    const emb = counting();
    const c = brain(emb);
    c.store.put({ type: "memory", kind: "fact", body: "One memory with no vector yet." });
    await backfillVectors({ counterpart: c, embedder: emb });
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
      stats: () => ({ hits: 0, misses: 0, cached: cache.size, fetched: 0, failed: 0, lastFailures: [] }),
    };
    const c = brain(wrong);
    c.store.put({ type: "memory", kind: "fact", body: "A memory whose vector will be cached wrong." });
    const report = await backfillVectors({ counterpart: c, embedder: wrong });
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

    await backfillVectors({ counterpart: c, embedder: emb });
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

  test("an id that fails EMBED_SKIP_AFTER runs leaves the queue, and is named (I33)", async () => {
    // The head-of-line block, in miniature. `missingVectors` returns a stable
    // order, so a row the provider will never accept is offered first at every
    // boundary forever and everything behind it stays blind. On the live store
    // that was 32 consecutive runs of `0 embedded / 64 failed` while `remaining`
    // climbed.
    const failures = [{ chunk: 0, from: 0, count: 1, code: "HTTP_ERROR" as const, status: 400, item: true }];
    const refuses: LiveEmbedder = {
      model: "test-embed-1",
      embed: () => null,
      vector: async () => null,
      warm: async () => 0,
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 1, failed: 1, lastFailures: failures }),
    };
    const c = brain(refuses);
    const poisoned = c.store.put({ type: "memory", kind: "fact", body: "A memory the embedder will not take." });

    for (let run = 1; run <= EMBED_SKIP_AFTER; run += 1) {
      const report = await backfillVectors({ counterpart: c, embedder: refuses });
      expect(report.failed).toBe(1);
      // THE CODE TRAVELS NOW. Without it the row read `failed: 1, reason: ran`
      // and a week of 400s looked like a flaky provider.
      expect(report.codes).toBe("HTTP_ERROR:400");
      expect(report.skipped).toBe(run < EMBED_SKIP_AFTER ? 0 : 1);
    }

    // Off the queue, and NAMED rather than silently gone.
    expect(c.store.missingVectors(64)).toEqual([]);
    expect(c.store.skippedVectorIds()).toEqual([poisoned]);
    expect(c.store.unembeddedCount()).toBe(0);
    expect((await backfillVectors({ counterpart: c, embedder: refuses })).reason).toBe(
      "nothing-missing",
    );

    // The durable row carries both fields, so tomorrow can read the give-up.
    const rows = c.store
      .eventLog({ name: "adapter.embed.backfill", limit: 10 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(rows.at(-1)?.["skipped"]).toBe(1);
    expect(rows.at(-2)?.["codes"]).toBe("HTTP_ERROR:400");

    // A SKIP IS NOT A REMOVAL. Clear the counter and the id is back in the
    // rotation, unarchived and never dark.
    //
    // THE SKIP IS SELF-SEALING, which is why clearing it needs a door of its
    // own. A run that LANDS clears the counter — but a skipped id is never
    // offered to a run again, so it cannot land; and `rebuildCache` has no
    // embedder to recompute a vector with and never touches box 2's meta. The
    // remedy is `verify --retry-skipped` (exercised in `cli.test.ts`), and this
    // line is the same write it makes.
    c.store.setMeta(`embed.failed.${poisoned}`, "0");
    expect(c.store.missingVectors(64)).toEqual([poisoned]);
    expect(c.store.skippedVectorIds()).toEqual([]);
  });

  test("a WHOLE-CHUNK failure retires nothing, however often it repeats", async () => {
    // I33 INVERTED, and refused. A 503 — or a 429, or the watchdog's abort —
    // says nothing about WHICH input is bad. Counting it toward the give-up
    // counter meant three bad boundaries retired a whole healthy window, and
    // `unembeddedCount` then read COMPLETE while those memories stayed blind:
    // the coverage watch failing in the optimistic direction, which is the one
    // direction a watch may never fail in.
    const failures = [{ chunk: 0, from: 0, count: 3, code: "HTTP_ERROR" as const, status: 503 }];
    const refuses: LiveEmbedder = {
      model: "test-embed-1",
      embed: () => null,
      vector: async () => null,
      warm: async () => 0,
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 3, failed: 3, lastFailures: failures }),
    };
    const c = brain(refuses);
    const ids = [1, 2, 3].map((n) =>
      c.store.put({ type: "memory", kind: "fact", body: `A perfectly healthy memory, number ${n}.` }),
    );

    for (let run = 1; run <= EMBED_SKIP_AFTER + 1; run += 1) {
      const report = await backfillVectors({ counterpart: c, embedder: refuses });
      expect(report.failed).toBe(3);
      // The CODE still travels — the row says what happened, it just does not
      // blame the rows for it.
      expect(report.codes).toBe("HTTP_ERROR:503");
      expect(report.skipped).toBe(0);
      expect(report.remaining).toBe(3);
    }

    expect(c.store.skippedVectorIds()).toEqual([]);
    expect(c.store.missingVectors(64).sort()).toEqual([...ids].sort());
    // The number a coverage watch reads never lied about these three.
    expect(c.store.unembeddedCount()).toBe(3);
  });

  test("a fill's counter moves are ONE box-2 transaction, and a healthy run writes none", async () => {
    // §5 G2, measured: one `setMeta` per id was one lock acquisition per id, at
    // a boundary where six workers may already be contending, on exactly the run
    // where things are going wrong.
    const failures = [
      { chunk: 0, from: 0, count: 1, code: "HTTP_ERROR" as const, status: 400, item: true },
    ];
    const refuses: LiveEmbedder = {
      model: "test-embed-1",
      embed: () => null,
      vector: async () => null,
      warm: async () => 0,
      stats: () => ({ hits: 0, misses: 0, cached: 0, fetched: 3, failed: 3, lastFailures: failures }),
    };
    const c = brain(refuses);
    for (const n of [1, 2, 3]) {
      c.store.put({ type: "memory", kind: "fact", body: `A memory the embedder refuses, number ${n}.` });
    }
    const before = c.store.events("store.meta").length;
    await backfillVectors({ counterpart: c, embedder: refuses });
    const metaWrites = c.store.events("store.meta").slice(before);
    expect(metaWrites.length).toBe(1);
    expect(metaWrites[0]?.data?.count).toBe(3);
  });

  test("a run where everything lands writes NO counter at all", async () => {
    // The common case must cost nothing: every counter is already zero, and a
    // write that sets zero to zero is a lock acquisition bought for nothing.
    const good = counting();
    const c = brain(good);
    c.store.put({ type: "memory", kind: "fact", body: "A memory that embeds on the first ask." });
    const before = c.store.events("store.meta").length;
    const ran = await backfillVectors({ counterpart: c, embedder: good });
    expect(ran.embedded).toBe(1);
    expect(ran.failed).toBe(0);
    expect(c.store.events("store.meta").length).toBe(before);
  });

  test("off is a record by name — never a zero (scar §2.4)", async () => {
    const c = brain(null);
    c.store.put({ type: "memory", kind: "fact", body: "A memory nobody will embed today." });
    expect((await backfillVectors({ counterpart: c, embedder: null })).reason).toBe(
      "embedder-off",
    );
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
