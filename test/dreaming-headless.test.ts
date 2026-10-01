/**
 * DREAMING, 2026-09-29 — the ask the person sees, and (later in this file) the
 * headless nightly run.
 *
 * A. With the setting `ask` (now the default) the day's dream line is shown to
 *    the PERSON in the terminal (the prompt hook's `systemMessage`) as well as
 *    handed to the model, and the day is claimed only when the envelope
 *    certainly carries the person's line — the plain reminder's rule.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No process is
 * started for real anywhere in this file except the stub executables it writes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KILL_GRACE_MS,
  NIGHT_KIND_ENV,
  NIGHT_MCP_SCRIPT,
  NIGHT_RUN_ENV,
  REAP_GRACE_MS,
  SCOPE_ASK,
  loadConfig,
  nightMcpConfig,
  nightTimeoutMs,
  openAdapter,
  openNightCounterpart,
  planNightChild,
  planNightRunner,
  readKind,
  runNight,
} from "../src/adapters/claude-code/index.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, HookInput, SpawnPlan } from "../src/adapters/claude-code/index.js";
import { ENVELOPE_MAX_CHARS, deliverTurn, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { readSession, recordSession } from "../src/adapters/sessions.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import { launchOptions } from "../src/adapters/mcp/bin/serve.js";
import { toolDefinitions } from "../src/adapters/mcp/tools.js";
import { dreamShowLines, nightRunLine } from "../src/adapters/cli/dream-core.js";
import { pageWriterNight } from "../src/core/self/index.js";
import { Counterpart as CounterpartClass } from "../src/core/counterpart.js";
import type { Counterpart } from "../src/core/counterpart.js";
import { DREAMING_DEFAULT, DREAM_MARK, DREAM_TUNABLES, RELAUNCHED_KEY, nightPartsWords, nightRunOf, nightRunWords } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: { close(): void }[] = [];
const AT = "2026-09-29";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-dreaming-headless-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function hooks(over: Partial<AdapterConfig> = {}): ReturnType<typeof openAdapter> {
  const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000, owner: true, ...over };
  const a = openAdapter(config, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
  open.push(a.counterpart);
  return a;
}

function input(over: Partial<HookInput> = {}): HookInput {
  const hook: HookInput = { sessionId: "s1", scope: "proj", turns: [], at: AT, prompt: "good morning", ...over };
  recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
  return hook;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

/** Lived days behind the store, and four new memories: the day's line is due. */
function lived(c: Counterpart): void {
  c.store.advanceClock("2026-09-10");
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  mem(c, "The migration step must run before the container boots, or it boots empty.");
  mem(c, "Run the migration before starting the container, otherwise the container starts empty.");
  mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" });
  mem(c, "I say what I do not know before I guess.", { kind: "self" });
}

function doorsOf(a: ReturnType<typeof openAdapter>): Parameters<typeof deliverTurn>[4] {
  return { updateNotice: () => null, markUpdateNotice: () => false, claimDream: a.claimDream.bind(a) };
}

// ═══════════════════════════════════════════════════════════════════════════
// A. the ask the person sees
// ═══════════════════════════════════════════════════════════════════════════

describe("A. the day's ask is shown to the person, and claimed only when it leaves", () => {
  test("`ask` is the default", () => {
    expect(DREAMING_DEFAULT).toBe("ask");
    const a = hooks();
    expect(a.counterpart.dreams.setting()).toBe("ask");
  });

  test("a prompt whose envelope has room: the terminal shows the ask, the model's line rides along, the day is claimed once", () => {
    const a = hooks();
    lived(a.counterpart);
    const turn = a.userPromptSubmit(input());
    const told = turn.dream;
    if (told === undefined) throw new Error("no dream line");
    expect(told.notice).toBe('Counterparts: I haven\'t dreamed yet (4 new memories). Say "dream" to start, or "dream on your own" to let me do it each day.');
    expect(turn.injection).toContain(told.context);
    const out = deliverTurn("user-prompt-submit", turn, {}, null, doorsOf(a), input());
    const parsed = JSON.parse(out.stdout) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
    expect(parsed.systemMessage).toBe(told.notice);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('says "dream on your own", call the dream tool with phase "setting"');
    expect(a.counterpart.store.dreamAsk(AT)?.state).toBe("offered");
    // Once a day: the next prompt, in any session, has no line.
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
  });

  test("an envelope with no room: nothing claimed, the model's line stripped too, and the next prompt offers it again", () => {
    const a = hooks();
    lived(a.counterpart);
    const turn = a.userPromptSubmit(input());
    const told = turn.dream;
    if (told === undefined) throw new Error("no dream line");
    const full = { ...turn, injection: `${turn.injection ?? ""}\n${"x".repeat(ENVELOPE_MAX_CHARS)}` };
    const out = deliverTurn("user-prompt-submit", full, {}, null, doorsOf(a), input());
    expect(out.stdout).not.toContain("dream on your own");
    expect(out.dropped).not.toBeNull();
    expect(a.counterpart.store.dreamAsk(AT)).toBeUndefined();
    // Not spent: the next prompt carries it.
    const again = a.userPromptSubmit(input());
    expect(again.dream?.notice).toBe(told.notice);
  });

  test("a claim lost to another session: this one shows nothing and tells the model nothing", () => {
    const a = hooks();
    lived(a.counterpart);
    const mine = a.userPromptSubmit(input());
    const theirs = a.userPromptSubmit(input({ sessionId: "s2" }));
    // The other session's delivery lands first.
    deliverTurn("user-prompt-submit", theirs, {}, null, doorsOf(a), input({ sessionId: "s2" }));
    expect(a.counterpart.store.dreamAsk(AT)?.session).toBe("s2");
    const out = deliverTurn("user-prompt-submit", mine, {}, null, doorsOf(a), input());
    expect(out.stdout).not.toContain("systemMessage");
    expect(out.stdout).not.toContain("dream on your own");
  });

  test("the run happens at the day's first session, so nothing it tells says \"last night\" (owner, 2026-09-29)", async () => {
    const a = hooks({ identity: { name: "Mike" } });
    lived(a.counterpart);
    const prompt = a.counterpart.dreams.launchPrompt({ session: "s1" });
    expect(prompt).toContain("since you last slept");
    expect(prompt.toLowerCase()).not.toContain("last night");
    const s = new McpServer({ counterpart: a.counterpart, scope: "proj", owner: true, registryDir: dir, session: "s1" });
    const launch = await s.call("dream", { phase: "launch", session: "s1" });
    expect(String(launch.structuredContent["how"])).toContain("While I slept I dreamed…");
    expect(JSON.stringify(launch.structuredContent).toLowerCase()).not.toContain("last night");
  });

  test("the reflection is told the writer revised the page earlier in this run, that every version is kept, and leans toward writing (owner)", async () => {
    const a = hooks({ identity: { name: "Mike" } });
    const c = a.counterpart;
    c.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(c.store).about });
    lived(c);
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    const s = new McpServer({ counterpart: c, scope: "proj", owner: true, registryDir: dir, session: "s1" });
    expect((await s.call("dream", { phase: "writer", session: "s1" })).structuredContent["writer"]).toBe(true);
    await s.call("self_page", { body: "## Core\n\nThe night's revision.", reason: "the night", session: "s1" });
    expect(c.selfPage()?.by).toBe("writer");
    const version = c.selfPage()?.version ?? -1;
    const d = c.dreams.begin({ session: "s1" });
    if (!d.ok) throw new Error(d.reason);
    c.dreams.journal({ dream: d.bundle.dream, session: "s1", text: "A dream." });
    const r = c.reflections.begin({ session: "s1", dream: d.bundle.dream });
    if (!r.ok) throw new Error(r.reason);
    expect(r.instructions).toContain(`The page writer revised your self page earlier in this run (version ${String(version)}, by the writer).`);
    expect(r.instructions).toContain("Every version of the page is kept, so rewriting it loses nothing.");
    expect(r.instructions).toContain("Mike would like a page written by a reflection every day");
    expect(r.instructions).toContain('on a "nothing much" night, leave it as it stands');
  });

  test("without a writer revision today, the page line still leans toward writing and says nothing about one", () => {
    const a = hooks({ identity: { name: "Mike" } });
    lived(a.counterpart);
    const r = a.counterpart.reflections.begin({ session: "s1" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.instructions).not.toContain("revised your self page earlier in this run");
    expect(r.instructions).toContain("lean toward writing it");
  });

  test("the dream tool's own description never ties `launch` to `auto` (review finding 2)", () => {
    const dream = toolDefinitions().find((t) => t["name"] === "dream");
    const text = JSON.stringify(dream);
    expect(text).toContain("Call `launch` only after the owner said");
    expect(text).toContain("this session launches nothing");
    expect(text).toContain("dream on your own");
    expect(text).not.toContain("the owner's setting `auto`), or after");
  });

  test("the nightly run's headless child and an observer are offered nothing", () => {
    const a = hooks();
    lived(a.counterpart);
    expect(a.userPromptSubmit(input({ sessionId: "pw", nightRun: true })).dream).toBeUndefined();
    const o = hooks({ observer: true });
    expect(o.userPromptSubmit(input({ sessionId: "o1" })).dream).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. the headless run's own process, proved against a stub `claude`
// ═══════════════════════════════════════════════════════════════════════════

describe("B. the headless run: the child's plan, and what becomes of a run", () => {
  let binDir: string;
  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "counterparts-night-bin-"));
  });
  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  /** A stub that records argv, environment, stdin and its directory, then runs `body`. */
  function stub(body: string): string {
    const path = join(binDir, "claude-stub");
    writeFileSync(
      path,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > ${JSON.stringify(join(binDir, "argv"))}`,
        `env > ${JSON.stringify(join(binDir, "env"))}`,
        `pwd > ${JSON.stringify(join(binDir, "cwd"))}`,
        `cat > ${JSON.stringify(join(binDir, "stdin"))}`,
        body,
      ].join("\n"),
      "utf8",
    );
    chmodSync(path, 0o755);
    return path;
  }

  const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, owner: true, identity: { name: "Mike" }, ...over });

  function nightOf(over: Partial<Parameters<typeof runNight>[0]> = {}): Parameters<typeof runNight>[0] {
    const cfg = over.config ?? config();
    return {
      open: () => openNightCounterpart(cfg),
      config: cfg,
      run: "nrn_test",
      session: "s1",
      scope: binDir,
      kind: { kind: "night" },
      date: AT,
      baseEnv: { PATH: "/usr/bin:/bin" },
      ...over,
    };
  }

  /** A counterpart on the test's store, closed after the test. */
  function openNight(): Counterpart {
    const c = openNightCounterpart(config());
    open.push(c);
    return c;
  }

  function latest(): ReturnType<typeof nightRunOf> {
    const c = openNightCounterpart(config());
    try {
      return nightRunOf(c.store);
    } finally {
      c.close();
    }
  }

  test("the child's plan, locked down: four tools, the built-ins denied, only counterparts' MCP server, a turn ceiling, a neutral directory, the prompt on stdin", () => {
    const plan = planNightChild({
      config: config({ dreaming: { model: "claude-opus-5-5" } }),
      run: "nrn_1",
      prompt: "THE PROMPT",
      scope: "/proj/here",
      session: "s-launch",
      runtime: "/usr/local/bin/bun",
      configPath: "/cfg/claude-code.json",
      baseEnv: {
        PATH: "/usr/bin",
        COUNTERPARTS_DATA_DIR: "/somewhere/else",
        COUNTERPARTS_SESSION: "parent",
        COUNTERPARTS_SCOPE: "/parent",
        COUNTERPARTS_OBSERVER: "1",
        CLAUDE_PROJECT_DIR: "/parent",
        CLAUDECODE: "1",
      },
    });
    expect(plan.ok).toBe(true);
    expect(plan.command).toBe("claude");
    expect(plan.args).toEqual([
      "-p",
      "--allowedTools",
      "mcp__counterparts__dream,mcp__counterparts__reflect,mcp__counterparts__self_page,mcp__counterparts__recall",
      // Deny beats allow: the user's own allow rules cannot reach these (review finding 3; owner B).
      "--disallowedTools",
      "Bash,PowerShell,REPL,Read,Write,Edit,NotebookEdit,Glob,Grep,LSP,WebFetch,WebSearch,Task,Agent,Skill,Workflow,SendMessage,Monitor,TaskStop,EnterWorktree,CronCreate,RemoteTrigger,Artifact",
      "--permission-mode",
      "default",
      "--max-turns",
      "60",
      "--mcp-config",
      nightMcpConfig({ runtime: "/usr/local/bin/bun", dataDir: dir, configPath: "/cfg/claude-code.json", session: "s-launch", scope: "/proj/here" }),
      "--strict-mcp-config",
      "--model",
      "claude-opus-5-5",
    ]);
    // ToolSearch stays: a host that defers MCP tools needs it to reach the four.
    expect(plan.args.join(" ")).not.toContain("ToolSearch");
    // The one MCP server: counterparts, as the install registers it, with the run's session and scope pinned.
    const mcp = JSON.parse(plan.args[plan.args.indexOf("--mcp-config") + 1] ?? "{}") as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(mcp.mcpServers)).toEqual(["counterparts"]);
    expect(mcp.mcpServers["counterparts"]?.command).toBe("/usr/local/bin/bun");
    expect(mcp.mcpServers["counterparts"]?.args[1]).toBe(NIGHT_MCP_SCRIPT);
    expect(mcp.mcpServers["counterparts"]?.args[1]?.endsWith(join("adapters", "mcp", "bin", "serve.ts"))).toBe(true);
    expect(mcp.mcpServers["counterparts"]?.env).toEqual({ COUNTERPARTS_DATA_DIR: dir, COUNTERPARTS_CONFIG: "/cfg/claude-code.json", COUNTERPARTS_SESSION: "s-launch", COUNTERPARTS_SCOPE: "/proj/here" });
    expect(plan.args.join(" ")).not.toContain("THE PROMPT");
    expect(plan.stdin).toBe("THE PROMPT");
    // A NEUTRAL directory, the store's own: no project's CLAUDE.md, hooks or MCP servers.
    expect(plan.cwd).toBe(dir);
    expect(planNightChild({ config: config({ dreaming: { maxTurns: 12 } }), run: "r", prompt: "p", scope: "/x", session: "s" }).args.join(" ")).toContain("--max-turns 12");
    expect(plan.timeoutMs).toBe(20 * 60_000);
    for (const gone of ["COUNTERPARTS_OBSERVER", "CLAUDE_PROJECT_DIR", "CLAUDECODE"]) {
      expect(plan.env[gone]).toBeUndefined();
    }
    // The LAUNCHING session and its directory, pinned over the parent's (finding 1 of the review).
    expect(plan.env["COUNTERPARTS_SESSION"]).toBe("s-launch");
    expect(plan.env["COUNTERPARTS_SCOPE"]).toBe("/proj/here");
    expect(plan.env[NIGHT_RUN_ENV]).toBe("nrn_1");
    expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(dir);
    expect(plan.env["COUNTERPARTS_CONFIG"]).toBe("/cfg/claude-code.json");
    // No model pinned: no flag.
    expect(planNightChild({ config: config(), run: "r", prompt: "p", scope: "/x", session: "s" }).args).not.toContain("--model");
    expect(planNightChild({ config: config({ observer: true }), run: "r", prompt: "p", scope: "/x", session: "s" }).reason).toBe("OBSERVER");
  });

  test("a model pin that looks like a flag is not read", () => {
    const loaded = loadConfig({ dataDir: dir, dreaming: { model: "--dangerously-skip-permissions", timeoutMs: -1 } });
    expect(loaded.config.dreaming?.model).toBeUndefined();
    expect(loaded.config.dreaming?.timeoutMs).toBeUndefined();
    expect(loaded.config.dreaming?.ignored?.length).toBe(2);
    expect(loaded.config.observer).toBeUndefined();
    expect(loadConfig({ dataDir: dir, dreaming: { model: "sonnet", timeoutMs: 60_000 } }).config.dreaming).toEqual({ model: "sonnet", timeoutMs: 60_000 });
  });

  test("the detached process's plan: pinned last, refused by name, and outlasting the child's watchdog", () => {
    const base = { config: config(), command: "/usr/bin/bun", run: "nrn_2", session: "s1", scope: "/proj", kind: { kind: "reflection", dream: "drm_x" } as const };
    const plan = planNightRunner({ ...base, args: ["run", "/pkg/bin/nightly.ts"], configPath: "/cfg.json", baseEnv: { COUNTERPARTS_SESSION: "other", COUNTERPARTS_OBSERVER: "1" } });
    expect(plan.ok).toBe(true);
    expect(plan.args).toEqual(["run", "/pkg/bin/nightly.ts"]);
    expect(plan.env["COUNTERPARTS_SESSION"]).toBe("s1");
    expect(plan.env["COUNTERPARTS_SCOPE"]).toBe("/proj");
    expect(plan.env[NIGHT_RUN_ENV]).toBe("nrn_2");
    expect(plan.env[NIGHT_KIND_ENV]).toBe("reflection:drm_x");
    expect(readKind(plan.env[NIGHT_KIND_ENV])).toEqual({ kind: "reflection", dream: "drm_x" });
    expect(plan.env["COUNTERPARTS_OBSERVER"]).toBeUndefined();
    expect(plan.timeoutMs).toBeGreaterThan(nightTimeoutMs(config()) + KILL_GRACE_MS + REAP_GRACE_MS);
    expect(planNightRunner({ ...base, args: undefined }).reason).toBe("NO_RUNNER");
    expect(planNightRunner({ ...base, args: ["x"], config: config({ observer: true }) }).reason).toBe("OBSERVER");
  });

  test("a stub that exits 0 having called no tool: the run could not do its job — `nothing-ran`; the prompt went on stdin, the child ran in the store's own directory", async () => {
    const out = await runNight(nightOf({ command: stub("exit 0") }));
    expect(out).toMatchObject({ state: "could-not-start", reason: "nothing-ran", code: 0, run: "nrn_test", date: AT, session: "s1" });
    expect(latest()).toMatchObject({ run: "nrn_test", state: "could-not-start", reason: "nothing-ran" });
    const stdin = readFileSync(join(binDir, "stdin"), "utf8");
    expect(stdin).toContain(DREAM_MARK);
    expect(stdin).toContain("session: s1");
    expect(readFileSync(join(binDir, "argv"), "utf8")).not.toContain("session: s1");
    expect(readFileSync(join(binDir, "env"), "utf8")).toContain(`${NIGHT_RUN_ENV}=nrn_test`);
    expect(readFileSync(join(binDir, "env"), "utf8")).toContain("COUNTERPARTS_SESSION=s1\n");
    // The neutral directory: the store's own, not the launching project (owner decision B).
    expect(realpathSync(readFileSync(join(binDir, "cwd"), "utf8").trim())).toBe(realpathSync(dir));
  });

  test("a stub that exits 1 at once: could not start (`quick-exit`) — is it logged in?", async () => {
    const out = await runNight(nightOf({ command: stub("exit 1") }));
    expect(out).toMatchObject({ state: "could-not-start", reason: "quick-exit", code: 1 });
    expect(nightRunWords(out)).toContain("is it logged in?");
  });

  test("no `claude` on the path: could not start (`no-claude`)", async () => {
    const out = await runNight(nightOf({ command: join(binDir, "no-such-claude") }));
    expect(out).toMatchObject({ state: "could-not-start", reason: "no-claude" });
    expect(nightRunWords(out)).toBe("the claude command was not found");
  });

  test("a run past its watchdog is stopped and recorded `timed-out`", async () => {
    const out = await runNight(nightOf({ config: config({ dreaming: { timeoutMs: 300 } }), command: stub("sleep 30") }));
    expect(out).toMatchObject({ state: "timed-out", reason: "watchdog" });
    expect(latest()?.state).toBe("timed-out");
  }, 20_000);

  test("a run that dreamed and reflected is `done`, with both ids — read from the store, not from its output", async () => {
    lived(openNight());
    const out = await runNight(
      nightOf({
        start: async () => {
          const c = openNightCounterpart(config());
          try {
            const d = c.dreams.begin({ session: "s1" });
            if (!d.ok) throw new Error(d.reason);
            c.dreams.journal({ dream: d.bundle.dream, session: "s1", text: "A dream." });
            const r = c.reflections.begin({ session: "s1", dream: d.bundle.dream });
            if (!r.ok) throw new Error(r.reason);
            c.reflections.finish({ reflection: r.bundle.reflection, session: "s1", entry: "Nothing much tonight." });
          } finally {
            c.close();
          }
          return { code: 0, timedOut: false, error: null };
        },
      }),
    );
    expect(out.state).toBe("done");
    expect(out.dream).toMatch(/^drm_/);
    expect(out.reflection).toMatch(/^rfl_/);
    // One event per state, latched by run and state.
    const c = openNight();
    const states = c.store.eventLog({ name: "dream.night" }).map((e) => String((JSON.parse(e.payload ?? "{}") as { state?: unknown }).state));
    expect(states.sort()).toEqual(["done", "started"]);
  });

  test("a run that began and then exited with an error is `failed`, not `could not start`", async () => {
    lived(openNight());
    let t = 1_000_000;
    const out = await runNight(
      nightOf({
        now: () => (t += 90_000),
        start: async () => {
          const c = openNightCounterpart(config());
          try {
            c.dreams.begin({ session: "s1" });
          } finally {
            c.close();
          }
          return { code: 3, timedOut: false, error: null };
        },
      }),
    );
    expect(out).toMatchObject({ state: "failed", reason: "exit", code: 3 });
  });

  test("a run that wrote the page and dreamed, but did not reflect, is PARTIAL — with which parts ran (owner; review finding 5)", async () => {
    const seed = openNight();
    // A day before today for the page writer to read.
    seed.store.put({ type: "memory", kind: "fact", body: "A placeholder thing noticed yesterday.", learnedOn: pageWriterNight(seed.store).about });
    lived(seed);
    recordSession(dir, { sessionId: "s1", scope: binDir, phase: "start" });
    const out = await runNight(
      nightOf({
        start: async () => {
          const c = openNightCounterpart(config());
          try {
            // The writer's phase, as the child's MCP server (pinned to s1) answers it.
            const s = new McpServer({ counterpart: c, scope: binDir, owner: true, registryDir: dir, session: "s1" });
            await s.call("dream", { phase: "writer", session: "s1" });
            const d = c.dreams.begin({ session: "s1" });
            if (!d.ok) throw new Error(d.reason);
            c.dreams.journal({ dream: d.bundle.dream, session: "s1", text: "A dream." });
          } finally {
            c.close();
          }
          return { code: 0, timedOut: false, error: null };
        },
      }),
    );
    expect(out).toMatchObject({ state: "partial", reason: "unfinished", code: 0, parts: ["writer", "dream"] });
    expect(out.dream).toMatch(/^drm_/);
    expect(nightPartsWords(out)).toBe("the page writer and the dream ran; the reflection did not");
    expect(nightRunLine(out)).toContain("partial (the whole night) — the page writer and the dream ran; the reflection did not");
    const f = nightRunFindings({ today: AT, config: config() } as unknown as DoctorInput, openNight().store)[0];
    expect(f?.detail).toContain("was partial");
    expect(f?.detail).toContain("the page writer and the dream ran; the reflection did not");
    // And the dream's own `--show` names the run it was part of.
    expect((dreamShowLines(openNight(), out.dream ?? "") ?? []).join("\n")).toContain("Latest headless run:");
  });
});

describe("B. the quiet child: the headless run's own hooks capture nothing and ask nothing", () => {
  test("the flag comes from the environment; its prompt has no dream line, its Stop no ask, its turns no spans", () => {
    const a = hooks();
    lived(a.counterpart);
    const flagged = toHookInput({ session_id: "child", hook_event_name: "Stop" }, { scope: "proj", env: { [NIGHT_RUN_ENV]: "nrn_q" } });
    expect(flagged.nightRun).toBe(true);
    expect(toHookInput({ session_id: "x" }, { scope: "proj", env: {} }).nightRun).toBeUndefined();
    const child = input({ sessionId: "child", nightRun: true });
    expect(a.userPromptSubmit(child).dream).toBeUndefined();
    const turns = [
      { role: "user" as const, text: "A long enough prompt that would ordinarily be captured as the day's words, twice over.", entry: 1 },
      { role: "assistant" as const, text: "And a long enough answer that would ordinarily be captured as well, with more words.", entry: 2 },
    ];
    const stop = a.stop({ ...child, turns });
    expect(stop.ask).toBeNull();
    expect(stop.spansAppended).toBe(0);
    // The same turns in an ordinary session are captured.
    expect(a.stop({ ...input({ sessionId: "ordinary" }), turns }).spansAppended).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. `auto` is headless: the hook starts the run, the model launches nothing
// ═══════════════════════════════════════════════════════════════════════════

describe("B. auto: the first prompt of the day starts the headless run itself", () => {
  let offsetMs = 0;
  let plans: SpawnPlan[] = [];
  beforeEach(() => {
    offsetMs = 0;
    plans = [];
  });

  /** An adapter whose clock the test moves, and whose spawner records instead of starting. */
  function autoHooks(opts: { nightArgs?: readonly string[] | null; observer?: boolean; config?: Partial<AdapterConfig> } = {}): ClaudeCodeAdapter {
    const config: AdapterConfig = { dataDir: dir, injectionBudgetBytes: 20_000, owner: true, identity: { name: "Mike" }, ...(opts.observer === true ? { observer: true } : {}), ...(opts.config ?? {}) };
    const counterpart = CounterpartClass.open({
      dir,
      owner: true,
      identity: { name: "Mike" },
      ...(opts.observer === true ? { observer: true } : {}),
      now: () => Date.now() + offsetMs,
    });
    open.push(counterpart);
    const nightArgs = opts.nightArgs === undefined ? ["run", "/pkg/bin/nightly.ts"] : opts.nightArgs;
    return new ClaudeCodeAdapter({
      counterpart,
      config,
      command: "/usr/bin/bun",
      args: ["run", "/pkg/bin/runner.ts"],
      ...(nightArgs === null ? {} : { nightArgs }),
      spawner: (p) => {
        plans.push(p);
        return { pid: 4242 };
      },
      now: () => Date.now() + offsetMs,
    });
  }

  const nightPlans = (): SpawnPlan[] => plans.filter((p) => p.args.includes("/pkg/bin/nightly.ts"));

  function setAuto(a: ClaudeCodeAdapter): void {
    lived(a.counterpart);
    expect(a.counterpart.dreams.setSetting("auto", { by: "owner" }).ok).toBe(true);
  }

  test("the day's first prompt claims the day and starts ONE detached run; the person is told, the model is told it has nothing to launch", () => {
    const a = autoHooks();
    setAuto(a);
    const turn = a.userPromptSubmit(input());
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    expect(plan.command).toBe("/usr/bin/bun");
    expect(plan.env[NIGHT_RUN_ENV]).toMatch(/^nrn_/);
    expect(plan.env[NIGHT_KIND_ENV]).toBe("night");
    expect(plan.env["COUNTERPARTS_SESSION"]).toBe("s1");
    expect(plan.env["COUNTERPARTS_SCOPE"]).toBe("proj");
    expect(plan.env["COUNTERPARTS_DATA_DIR"]).toBe(dir);
    expect(a.counterpart.store.dreamAsk(AT)?.state).toBe("launched");
    expect(a.counterpart.dreams.nightRun()).toMatchObject({ state: "started", session: "s1", date: AT, kind: "night", run: plan.env[NIGHT_RUN_ENV] });
    // The terminal line; already claimed, so the delivery only shows it.
    expect(turn.dream?.notice).toBe('Counterparts: dreaming in the background (a few minutes). Say "no dreams" to turn it off.');
    expect(turn.dream?.offer).toBeNull();
    expect(turn.injection).toContain("there is nothing for you to launch");
    // Neutral about the terminal: the envelope may have had no room (review finding 6).
    expect(turn.injection).not.toContain("Shown to Mike just now");
    // The session says it once, in its first reply (lane 8, build 4); the terminal line is the extra.
    expect(turn.injection).toContain("Tell Mike this once, in your first reply, as one plain sentence of your own.");
    expect(turn.injection).toContain("Mike may also see it in the terminal");
    // With no room, the run has still started, the model's line stays, and only the terminal line waits.
    const full = { ...turn, injection: `${turn.injection ?? ""}\n${"x".repeat(ENVELOPE_MAX_CHARS)}` };
    const crowded = deliverTurn("user-prompt-submit", full, {}, null, doorsOf(a as unknown as ReturnType<typeof openAdapter>), input());
    expect(crowded.stdout).toContain("there is nothing for you to launch");
    expect(crowded.stdout).not.toContain("systemMessage");
    expect(turn.injection).not.toContain('phase "launch"');
    const out = deliverTurn("user-prompt-submit", turn, {}, null, doorsOf(a as unknown as ReturnType<typeof openAdapter>), input());
    expect((JSON.parse(out.stdout) as { systemMessage: string }).systemMessage).toBe(turn.dream?.notice ?? "-");
    // Once a day: another session, another prompt — no second run.
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
    expect(nightPlans()).toHaveLength(1);
  });

  test("a session left open overnight (stale in the registry) still starts a run the child's MCP server will serve — the session is PINNED, not lazy-bound", async () => {
    const a = autoHooks();
    setAuto(a);
    // The session's last boundary was nine hours ago.
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    offsetMs = 9 * 60 * 60_000;
    const later = (): number => Date.now() + offsetMs;
    // Stale, the lazy bind the child used to rely on refuses the call.
    const lazy = new McpServer({ counterpart: a.counterpart, scope: "proj", owner: true, registryDir: dir, now: later });
    const refused = await lazy.call("dream", { phase: "writer", session: "s1" });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.structuredContent)).toContain("session-not-live");
    a.userPromptSubmit({ sessionId: "s1", scope: "proj", turns: [], at: AT, prompt: "morning" });
    // Since 2026-10-01 the prompt refreshes the session's record (review of #309) —
    // but the run's child does not depend on that: it is pinned.
    expect(readSession(dir, "s1")?.lastBoundaryAt ?? 0).toBeGreaterThan(Date.now() + offsetMs - 60_000);
    const runner = nightPlans()[0];
    if (runner === undefined) throw new Error("no run started");
    // What bin/nightly.ts hands its child, and how the child's server reads it.
    const child = planNightChild({ config: { dataDir: dir }, run: "nrn_x", prompt: "p", scope: String(runner.env["COUNTERPARTS_SCOPE"]), session: String(runner.env["COUNTERPARTS_SESSION"]) });
    const launched = launchOptions([], child.env);
    expect(launched.session).toBe("s1");
    const pinned = new McpServer({ counterpart: a.counterpart, scope: "proj", owner: true, registryDir: dir, now: later, ...(launched.session === undefined ? {} : { session: launched.session }) });
    const ok = await pinned.call("dream", { phase: "writer", session: "s1" });
    expect(ok.isError ?? false).toBe(false);
  });

  test("a run that could not even be started (no runner) falls back to the ask in the SAME prompt, and says why", () => {
    const a = autoHooks({ nightArgs: null });
    setAuto(a);
    const turn = a.userPromptSubmit(input());
    expect(nightPlans()).toHaveLength(0);
    expect(a.counterpart.dreams.nightRun()).toMatchObject({ state: "could-not-start", reason: "runner", detail: "NO_RUNNER" });
    expect(turn.dream?.notice).toBe('Counterparts: I couldn\'t start dreaming on my own: the background process could not start (NO_RUNNER). Say "dream" to do it here.');
    // An ask: claimed at delivery.
    expect(turn.dream?.offer).not.toBeNull();
    expect(turn.injection).toContain('phase "launch"');
    deliverTurn("user-prompt-submit", turn, {}, null, doorsOf(a as unknown as ReturnType<typeof openAdapter>), input());
    expect(a.counterpart.store.dreamAsk(AT)?.state).toBe("offered");
    // Asked once: the next prompt says nothing.
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
  });

  test("a run the detached process reports could not start: the NEXT prompt asks at once, with the reason — no second run", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    // What `bin/nightly.ts` writes when `claude -p` exits 1 at once.
    a.counterpart.dreams.recordNightRun({ ...started, state: "could-not-start", reason: "quick-exit", code: 1, endedAt: started.startedAt + 2_000 });
    offsetMs += 5_000;
    const next = a.userPromptSubmit(input({ sessionId: "s2" }));
    expect(next.dream?.notice).toBe('Counterparts: I couldn\'t start dreaming on my own: claude stopped straight away (exit 1) — is it logged in? Say "dream" to do it here.');
    expect(nightPlans()).toHaveLength(1);
    deliverTurn("user-prompt-submit", next, {}, null, doorsOf(a as unknown as ReturnType<typeof openAdapter>), input({ sessionId: "s2" }));
    expect(a.counterpart.store.dreamAsk(AT)).toMatchObject({ state: "offered", session: "s2" });
    // An ask, not a run started again: no relaunch spent, recorded as `offered` after could-not-start (review finding 7).
    expect(a.counterpart.store.getMeta(RELAUNCHED_KEY)).toBeUndefined();
    const asks = a.counterpart.store.eventLog({ name: "dream.ask" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(asks.map((p) => p["state"])).toEqual(expect.arrayContaining(["launched", "offered"]));
    expect(asks.some((p) => p["state"] === "relaunched")).toBe(false);
    expect(asks.find((p) => p["state"] === "offered")?.["after"]).toBe("could-not-start");
    expect(a.userPromptSubmit(input({ sessionId: "s3" })).dream).toBeUndefined();
  });

  test("a headless run cut off after its dream: the next first session starts the REFLECTION alone, headless", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const d = a.counterpart.dreams.begin({ session: "s1", at: AT });
    if (!d.ok) throw new Error(d.reason);
    a.counterpart.dreams.journal({ dream: d.bundle.dream, session: "s1", text: "A dream." });
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const turn = a.userPromptSubmit(input({ sessionId: "s2" }));
    expect(nightPlans()).toHaveLength(2);
    expect(nightPlans()[1]?.env[NIGHT_KIND_ENV]).toBe(`reflection:${d.bundle.dream}`);
    expect(turn.dream?.notice).toContain("finishing my reflection in the background");
  });

  test("a finished run's hand-back reaches the next prompt ONCE — even in the session that started it", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    // The run, as the headless child would do it through the MCP tools.
    const d = a.counterpart.dreams.begin({ session: "s1", at: AT });
    if (!d.ok) throw new Error(d.reason);
    a.counterpart.dreams.journal({ dream: d.bundle.dream, session: "s1", title: "Boot order", text: "A dream." });
    a.counterpart.dreams.recordNightRun({ ...started, state: "done", code: 0, endedAt: a.counterpart.store.now(), dream: d.bundle.dream });
    const next = a.userPromptSubmit(input({ prompt: "back again" }));
    expect(next.injection).toContain("the nightly run finished in the background, on its own");
    expect(next.injection).toContain('"Boot order"');
    expect(next.injection).toContain(`counterparts dream --show ${d.bundle.dream}`);
    expect(a.userPromptSubmit(input({ sessionId: "s2", prompt: "and again" })).injection).not.toContain("the nightly run finished");
    // Handed: the row says so, and later prompts only read it — one latch row, ever.
    expect(a.counterpart.dreams.nightRun()?.handedAt).toBeGreaterThan(0);
    expect(a.counterpart.store.eventLog({ name: "dream.night.handed" })).toHaveLength(1);
    expect(a.counterpart.store.eventLog({ name: "dream.night" }).filter((e) => e.ref === started.run)).toHaveLength(2);
  });

  test("a partial run's hand-back says it was partial; the reflection-alone run after it hands back no second dream line (review finding 5)", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    const d = a.counterpart.dreams.begin({ session: "s1", at: AT });
    if (!d.ok) throw new Error(d.reason);
    a.counterpart.dreams.journal({ dream: d.bundle.dream, session: "s1", title: "Boot order", text: "A dream." });
    a.counterpart.dreams.recordNightRun({ ...started, state: "partial", reason: "unfinished", code: 0, endedAt: a.counterpart.store.now(), dream: d.bundle.dream, parts: ["dream"] });
    const told = a.userPromptSubmit(input({ prompt: "back" }));
    expect(told.injection).toContain("(only part of it: the dream ran; the reflection did not)");
    expect(told.injection).toContain('"Boot order"');
    // The reflection alone, later, headless: its hand-back is the share only.
    a.counterpart.dreams.recordNightRun({ ...started, run: "nrn_refl", kind: "reflection", state: "done", startedAt: a.counterpart.store.now() + 1, endedAt: a.counterpart.store.now() + 2, code: 0, dream: d.bundle.dream, reflection: "rfl_none", parts: ["reflection"] });
    const later = a.userPromptSubmit(input({ sessionId: "s2", prompt: "later" }));
    expect(later.injection).not.toContain('"Boot order"');
    expect(a.counterpart.dreams.nightRun()?.handedAt).toBeGreaterThan(0);
  });

  test("the next calendar day tries headless again, whatever happened the day before", () => {
    const a = autoHooks({ nightArgs: null });
    setAuto(a);
    a.userPromptSubmit(input());
    expect(a.counterpart.dreams.nightRun()?.state).toBe("could-not-start");
    const b = autoHooks();
    const tomorrow = b.userPromptSubmit(input({ sessionId: "t1", at: "2026-09-30" }));
    expect(nightPlans()).toHaveLength(1);
    expect(tomorrow.dream?.notice).toContain("dreaming in the background");
  });

  test("a run that never reports falls back to ASKING once it is past its watchdog — not another headless start (review finding 4)", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    expect(nightPlans()).toHaveLength(1);
    expect(a.counterpart.dreams.nightRun()?.timeoutMs).toBe(20 * 60_000);
    // Nothing ran: the detached process died without a word.
    offsetMs += 31 * 60_000;
    const next = a.userPromptSubmit(input({ sessionId: "s2" }));
    expect(nightPlans()).toHaveLength(1);
    expect(next.dream?.offer).not.toBeNull();
    expect(next.dream?.notice).toContain("it never reported back");
    const f = nightRunFindings({ today: AT, config: { dataDir: dir } } as unknown as DoctorInput, a.counterpart.store)[0];
    expect(f?.severity).toBe("amber");
    expect(f?.fix).toContain("The next session asks instead");
  });

  test("a run that timed out having begun nothing asks at once; one that began a dream is left behind and relaunched headless", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    a.counterpart.dreams.recordNightRun({ ...started, state: "timed-out", reason: "watchdog", endedAt: started.startedAt + 20 * 60_000 });
    const next = a.userPromptSubmit(input({ sessionId: "s2" }));
    expect(next.dream?.notice).toContain("it ran too long and was stopped before it finished anything");
    expect(nightPlans()).toHaveLength(1);
  });

  test("a run that failed after beginning its dream does not fall back: the ordinary relaunch resumes it headless", () => {
    const a = autoHooks();
    setAuto(a);
    a.userPromptSubmit(input());
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    const d = a.counterpart.dreams.begin({ session: "s1", at: AT });
    if (!d.ok) throw new Error(d.reason);
    a.counterpart.dreams.propose({ dream: d.bundle.dream, session: "s1", changes: [{ action: "replayed", id: (d.bundle.fresh[0]?.id ?? "") }] });
    a.counterpart.dreams.recordNightRun({ ...started, state: "failed", reason: "exit", code: 1, endedAt: a.counterpart.store.now() });
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const later = a.userPromptSubmit(input({ sessionId: "s3" }));
    expect(nightPlans()).toHaveLength(2);
    expect(later.dream?.notice).toContain("picking up my dream where it was cut off");
  });

  test("a long watchdog: a run still inside it is under way — no second run starts beside it (review finding 10)", () => {
    const a = autoHooks({ config: { dreaming: { timeoutMs: 60 * 60_000 } } });
    setAuto(a);
    a.userPromptSubmit(input());
    // Slow: 31 minutes in, no dream begun yet.
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(a.counterpart.dreams.status(AT).reason).toBe("dreaming-now");
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dream).toBeUndefined();
    expect(nightPlans()).toHaveLength(1);
    // Past its own watchdog and the grace, it is lost, and the line asks.
    offsetMs += 40 * 60_000;
    expect(a.userPromptSubmit(input({ sessionId: "s3" })).dream?.notice).toContain("it never reported back");
    expect(nightPlans()).toHaveLength(1);
  });

  test("\"no dreams\" while a run is going: the setting is off from the next run, the run in flight finishes, and both doors say so (owner decision D)", async () => {
    const a = autoHooks();
    setAuto(a);
    const turn = a.userPromptSubmit(input());
    expect(turn.injection).toContain("it takes effect from the next run (a run already under way finishes)");
    expect(a.counterpart.dreams.nightRunUnderWay()).toBe(true);
    const s = new McpServer({ counterpart: a.counterpart, scope: "proj", owner: true, registryDir: dir, session: "s1" });
    const off = await s.call("dream", { phase: "setting", session: "s1", value: "off" });
    expect(String(off.structuredContent["said"])).toContain("A run already under way in the background finishes; the setting takes effect from the next run.");
    // Nothing was stopped: the run's row is still `started`.
    expect(a.counterpart.dreams.nightRun()?.state).toBe("started");
    expect(a.counterpart.dreams.setting()).toBe("off");
    // With no run going, "off" says nothing about one.
    const started = a.counterpart.dreams.nightRun();
    if (started === null) throw new Error("no run");
    a.counterpart.dreams.recordNightRun({ ...started, state: "done", endedAt: a.counterpart.store.now(), code: 0 });
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    const again = await s.call("dream", { phase: "setting", session: "s1", value: "off" });
    expect(String(again.structuredContent["said"])).not.toContain("under way");
  });

  test("a store with `auto` written before this version is set back to `ask` ONCE, recorded, and the owner told once (owner decision A)", () => {
    const a = autoHooks();
    lived(a.counterpart);
    // As 0.3.6 left it: `auto` in the meta, no marker.
    a.counterpart.store.setMeta("dream.setting", "auto");
    const first = a.userPromptSubmit(input());
    expect(a.counterpart.dreams.setting()).toBe("ask");
    // No headless run on the first prompt after the upgrade: the day's line is the ask.
    expect(nightPlans()).toHaveLength(0);
    expect(first.dreamNote?.notice).toContain('I set it back to asking. Say "dream on your own" to turn it on again.');
    expect(first.injection).toContain("the owner's `auto` was set back to `ask`, once");
    const reset = a.counterpart.store.eventLog({ name: "dream.ask" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>).find((p) => p["by"] === "upgrade");
    expect(reset).toMatchObject({ state: "setting", setting: "ask", before: "auto" });
    const doors = { updateNotice: () => null, markUpdateNotice: () => false, claimDream: a.claimDream.bind(a), claimDreamNote: a.claimDreamNote.bind(a) };
    const out = deliverTurn("user-prompt-submit", first, {}, null, doors, input());
    expect((JSON.parse(out.stdout) as { systemMessage: string }).systemMessage).toContain("dreaming changed in this version");
    // Told once: the next prompt has no note.
    expect(a.userPromptSubmit(input({ sessionId: "s2" })).dreamNote).toBeUndefined();
    // The owner's next "dream on your own" sets auto again, and it stays.
    a.counterpart.dreams.setSetting("auto", { by: "session", session: "s2" });
    a.userPromptSubmit(input({ sessionId: "s3" }));
    expect(a.counterpart.dreams.setting()).toBe("auto");
  });

  test("a store that chose `auto` on this version, or never wrote a setting, is not reset", () => {
    const a = autoHooks();
    lived(a.counterpart);
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    expect(a.userPromptSubmit(input()).dreamNote).toBeUndefined();
    expect(a.counterpart.dreams.setting()).toBe("auto");
    expect(nightPlans()).toHaveLength(1);
  });

  test("an observer starts nothing and says nothing", () => {
    const a = autoHooks();
    setAuto(a);
    a.counterpart.close();
    open.splice(open.indexOf(a.counterpart), 1);
    const o = autoHooks({ observer: true });
    expect(o.userPromptSubmit(input()).dream).toBeUndefined();
    expect(nightPlans()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. doctor's Nightly run line
// ═══════════════════════════════════════════════════════════════════════════

describe("B. doctor: the Nightly run line reads the one-row record", () => {
  const doctorInput = { today: AT, config: { dataDir: dir } } as unknown as DoctorInput;
  const base = { run: "nrn_d", date: AT, kind: "night" as const, session: "s1", reason: null, detail: null, code: null, dream: null, reflection: null };

  test("silent with no run and no auto; green with auto and no run yet; green when a run finished", () => {
    const a = hooks();
    const s = a.counterpart.store;
    expect(nightRunFindings(doctorInput, s)).toEqual([]);
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    expect(nightRunFindings(doctorInput, s)[0]).toMatchObject({ severity: "green", title: "Nightly run" });
    const now = s.now();
    a.counterpart.dreams.recordNightRun({ ...base, state: "done", startedAt: now - 5 * 60_000, endedAt: now, code: 0, dream: "drm_1", reflection: "rfl_1" });
    const done = nightRunFindings(doctorInput, s)[0];
    expect(done?.severity).toBe("green");
    expect(done?.detail).toBe(`auto; last run ${AT} (the whole night) finished after 5 min — drm_1, rfl_1`);
  });

  test("amber while auto and the latest run could not start — with the reason and what to look at", () => {
    const a = hooks();
    const s = a.counterpart.store;
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    const now = s.now();
    a.counterpart.dreams.recordNightRun({ ...base, state: "could-not-start", startedAt: now, endedAt: now + 1_000, reason: "no-claude" });
    const f = nightRunFindings(doctorInput, s)[0];
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("could not start");
    expect(f?.detail).toContain("the claude command was not found");
    expect(f?.fix).toContain("PATH");
    // The owner's setting moved to ask: informational.
    a.counterpart.dreams.setSetting("ask", { by: "owner" });
    expect(nightRunFindings(doctorInput, s)[0]?.severity).toBe("green");
  });

  test("a run started long ago that never reported an end is amber; one started just now is running", () => {
    const a = hooks();
    const s = a.counterpart.store;
    a.counterpart.dreams.setSetting("auto", { by: "owner" });
    const now = s.now();
    a.counterpart.dreams.recordNightRun({ ...base, run: "nrn_old", state: "started", startedAt: now - 2 * 60 * 60_000, endedAt: null });
    const lost = nightRunFindings(doctorInput, s)[0];
    expect(lost?.severity).toBe("amber");
    expect(lost?.detail).toContain("never reported an end");
    a.counterpart.dreams.recordNightRun({ ...base, state: "started", startedAt: now - 60_000, endedAt: null });
    expect(nightRunFindings(doctorInput, s)[0]?.detail).toContain("running now");
    // A late word from the older run never overwrites the newer run's row.
    a.counterpart.dreams.recordNightRun({ ...base, run: "nrn_old", state: "failed", startedAt: now - 2 * 60 * 60_000, endedAt: now, reason: "exit", code: 1 });
    expect(nightRunOf(s)?.run).toBe("nrn_d");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test gaps the review named (finding 14)
// ═══════════════════════════════════════════════════════════════════════════

describe("gaps: the quiet child at SessionStart, SessionEnd and PreCompact", () => {
  test("no first-launch question at SessionStart; nothing captured at SessionEnd or PreCompact", () => {
    const a = hooks();
    const turns = [
      { role: "user" as const, text: "A long enough prompt that would ordinarily be captured as the day's words, twice over.", entry: 1 },
      { role: "assistant" as const, text: "And a long enough answer that would ordinarily be captured as well, with more words.", entry: 2 },
    ];
    // An ordinary session in an unregistered directory is asked the scope question…
    expect(a.sessionStart(input({ sessionId: "ordinary" })).ask ?? "").toContain(SCOPE_ASK);
    // …the headless run's child is not.
    expect(a.sessionStart(input({ sessionId: "child", nightRun: true })).ask ?? "").not.toContain(SCOPE_ASK);
    expect(a.sessionEnd({ ...input({ sessionId: "child", nightRun: true }), turns }).spansAppended).toBe(0);
    expect(a.preCompact({ ...input({ sessionId: "child2", nightRun: true }), turns }).spansAppended).toBe(0);
    expect(a.sessionEnd({ ...input({ sessionId: "ordinary" }), turns }).spansAppended).toBeGreaterThan(0);
  });
});

describe("the headless child's bundles carry the memories — in what Claude Code hands the model (the first real run, 2026-09-29)", () => {
  test("a server opened from the child's own --mcp-config env: dream begin and reflect begin carry the bodies in structuredContent", async () => {
    // The coordinator's seed, as in the real run.
    const scope = mkdtempSync(join(tmpdir(), "counterparts-bodies-project-"));
    try {
      const seed = openNightCounterpart({ dataDir: dir });
      seed.store.advanceClock("2026-09-10");
      for (let d = 11; d <= 28; d += 1) seed.store.advanceClock(`2026-09-${String(d).padStart(2, "0")}`);
      const day = seed.store.livedDay();
      const put = (body: string, kind: "fact" | "person" | "self" = "fact"): void => {
        seed.store.put({ type: "memory", kind, body, salience: { relevance: 0.6, emotional: 0.4, predictive: 0.6 }, physics: { birthDay: day, lastUsedDay: day } });
      };
      put("The migration step must run before the container boots, or it boots empty.");
      put("Run the migration before starting the container, otherwise the container starts empty.");
      put("Mike likes to talk decisions through out loud before he commits to one.", "person");
      put("I say what I do not know before I guess.", "self");
      put("Tiny Castles upkeep is 8 food a day per spearman.");
      put("Tiny Castles upkeep is 16 food a day per spearman.");
      seed.close();
      recordSession(dir, { sessionId: "e2e-s1", scope, phase: "start" });
      // Exactly what bin/nightly.ts hands `claude -p` for its one MCP server.
      const child = planNightChild({ config: { dataDir: dir, owner: true, identity: { name: "Mike" } }, run: "nrn_b", prompt: "p", scope, session: "e2e-s1", runtime: process.execPath });
      const mcp = JSON.parse(child.args[child.args.indexOf("--mcp-config") + 1] ?? "{}") as { mcpServers: { counterparts: { env: Record<string, string> } } };
      const launch = launchOptions([], mcp.mcpServers.counterparts.env);
      const s = openServer({ ...launch, dir });
      open.push(s.counterpart);
      const begin = await s.call("dream", { phase: "begin", session: "e2e-s1" });
      expect(begin.isError ?? false).toBe(false);
      // What the host shows the model is the structured copy, serialized.
      const seen = JSON.stringify(begin.structuredContent);
      expect(seen).toContain("Tiny Castles upkeep is 8 food a day per spearman.");
      expect(seen).toContain("Tiny Castles upkeep is 16 food a day per spearman.");
      expect(seen).toContain("Run the migration before starting the container");
      const dreamId = String(begin.structuredContent["dream"]);
      await s.call("dream", { phase: "journal", session: "e2e-s1", dream: dreamId, text: "A dream." });
      const r = await s.call("reflect", { phase: "begin", session: "e2e-s1", dream: dreamId });
      expect(r.isError ?? false).toBe(false);
      expect(JSON.stringify(r.structuredContent)).toContain("Tiny Castles upkeep is 16 food a day per spearman.");
    } finally {
      rmSync(scope, { recursive: true, force: true });
    }
  });
});

describe("gaps: bin/nightly.ts end to end, against a stub `claude` first on PATH", () => {
  test("the real entry point composes, starts the stub with the pinned session, and records the run", () => {
    const bin = mkdtempSync(join(tmpdir(), "counterparts-nightly-e2e-"));
    try {
      const scope = join(bin, "project");
      mkdirSync(scope);
      const stubDir = join(bin, "stub");
      mkdirSync(stubDir);
      const stub = join(stubDir, "claude");
      writeFileSync(
        stub,
        ["#!/bin/sh", `printf '%s\\n' "$@" > ${JSON.stringify(join(bin, "argv"))}`, `env > ${JSON.stringify(join(bin, "env"))}`, `cat > ${JSON.stringify(join(bin, "stdin"))}`, "exit 0"].join("\n"),
        "utf8",
      );
      chmodSync(stub, 0o755);
      const configPath = join(bin, "claude-code.json");
      writeFileSync(configPath, JSON.stringify({ dataDir: dir, owner: true, identity: { name: "Mike" } }), "utf8");
      const seed = openNightCounterpart({ dataDir: dir });
      lived(seed);
      seed.close();
      const nightly = join(import.meta.dir, "..", "src", "adapters", "claude-code", "bin", "nightly.ts");
      const out = Bun.spawnSync([process.execPath, "run", nightly], {
        env: {
          PATH: `${stubDir}:/usr/bin:/bin`,
          HOME: bin,
          COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
          COUNTERPARTS_CONFIG: configPath,
          COUNTERPARTS_DATA_DIR: dir,
          COUNTERPARTS_SESSION: "s1",
          COUNTERPARTS_SCOPE: scope,
          COUNTERPARTS_NIGHT_RUN: "nrn_e2e",
          COUNTERPARTS_NIGHT_KIND: "night",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(out.exitCode).toBe(0);
      const argv = readFileSync(join(bin, "argv"), "utf8");
      expect(argv).toContain("--disallowedTools");
      expect(argv).toContain("--strict-mcp-config");
      expect(argv).toContain("--max-turns");
      expect(argv).not.toContain("session: s1");
      expect(readFileSync(join(bin, "stdin"), "utf8")).toContain("session: s1");
      const env = readFileSync(join(bin, "env"), "utf8");
      expect(env).toContain("COUNTERPARTS_SESSION=s1\n");
      expect(env).toContain("COUNTERPARTS_NIGHT_RUN=nrn_e2e\n");
      const c = openNightCounterpart({ dataDir: dir });
      open.push(c);
      // The stub called no tool: the run could not do its job, and says why.
      expect(c.dreams.nightRun()).toMatchObject({ run: "nrn_e2e", state: "could-not-start", reason: "nothing-ran", session: "s1" });
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }, 30_000);

  test("stood down with no session, it still records the run so the next prompt can ask", () => {
    const bin = mkdtempSync(join(tmpdir(), "counterparts-nightly-e2e-"));
    try {
      const configPath = join(bin, "claude-code.json");
      writeFileSync(configPath, JSON.stringify({ dataDir: dir }), "utf8");
      const nightly = join(import.meta.dir, "..", "src", "adapters", "claude-code", "bin", "nightly.ts");
      const out = Bun.spawnSync([process.execPath, "run", nightly], {
        env: { PATH: "/usr/bin:/bin", HOME: bin, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_CONFIG: configPath, COUNTERPARTS_DATA_DIR: dir, COUNTERPARTS_NIGHT_RUN: "nrn_nosession" },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(out.exitCode).toBe(0);
      const c = openNightCounterpart({ dataDir: dir });
      open.push(c);
      expect(c.dreams.nightRun()).toMatchObject({ run: "nrn_nosession", state: "could-not-start", reason: "refused", detail: "NO_SESSION" });
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }, 30_000);
});
