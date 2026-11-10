/**
 * CX2 — THE CODEX HOST (2026-11-09): the hooks, the MCP door, connect and
 * doctor, and Mike's two addenda (a Codex `me` is the model's own note; a Codex
 * that Claude Code started stands down).
 *
 * Hermetic: every test makes a temp root with its own HOME, CODEX_HOME,
 * configuration and store, and removes it. `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`
 * throughout. The rollout fixture copies the SHAPE of the 11-09 probe's
 * transcript (record types, roles, provenance metadata) with invented words.
 * No real `~/.codex`, `~/.claude` or store is named.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { runCodexHook } from "../src/adapters/codex/bin/hook.js";
import { codexFindings } from "../src/adapters/codex/doctor.js";
import { codexDelivery } from "../src/adapters/codex/envelope.js";
import { CODEX_STOP_OPENER, parseCodexTranscript } from "../src/adapters/codex/transcript.js";
import { mergeCodexHooks, ourPositions, stateKey, tomlProblem } from "../src/adapters/codex/wire.js";
import { CODEX_STOP_OPENER_WORDS, codexStandDown, codexStopAsk } from "../src/adapters/codex/words.js";
import { CODEX_HOST } from "../src/adapters/hosts.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { CODEX_INSTRUCTIONS } from "../src/adapters/mcp/server.js";
import { launchOptions } from "../src/adapters/mcp/bin/serve.js";
import { canonicalScope, readSession } from "../src/adapters/sessions.js";
import type { Spawner } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";
import { aboutMe, selfRelevantFeeling } from "../src/core/sleep/index.js";
import { feelingWeeks } from "../src/core/dream/feeling-weeks.js";
import { wireCodex } from "../src/adapters/cli/codex.js";
import { storyHeadStart } from "../src/core/self/stories.js";
import { isStoreError } from "../src/core/store/index.js";
import { readerSelfOfRow, readerUsOfRow } from "../src/core/reader-note.js";
import { WAKE_SHAPE_KEY } from "../src/core/counterpart-wake-shape.js";
import { strength } from "../src/core/physics/index.js";

const MODEL = "gpt-test-9";
const HOOK = resolve(import.meta.dir, "../src/adapters/codex/bin/hook.ts");

let root: string;
let home: string;
let codexHome: string;
let cfg: string;
let store: string;
let project: string;
let spawned: number;

const spawner: Spawner = () => {
  spawned += 1;
  return { pid: 4242 };
};

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin",
    HOME: home,
    CODEX_HOME: codexHome,
    COUNTERPARTS_CONFIG: cfg,
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    ...extra,
  };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-codex-")));
  home = join(root, "home");
  codexHome = join(root, "codex");
  project = join(root, "project");
  store = join(root, "cp", "store");
  cfg = join(root, "cp", "claude-code.json");
  for (const d of [home, codexHome, project, join(root, "cp")]) mkdirSync(d, { recursive: true });
  writeFileSync(cfg, JSON.stringify({ dataDir: store, injectionBudgetBytes: 9_000, embedder: { enabled: false } }));
  Counterpart.open({ dir: store }).close();
  spawned = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── the fixture: a rollout shaped like the 11-09 probe's ───────────────────

type Line = Record<string, unknown>;
const at = (n: number): string => new Date(Date.UTC(2026, 10, 9, 22, 45, n)).toISOString();

function msg(role: string, text: string, kinds: string[], prov: Record<string, unknown> | null, n: number): Line {
  return {
    timestamp: at(n),
    type: "response_item",
    payload: {
      type: "message",
      id: `msg_${String(n)}`,
      role,
      ...(role === "assistant" ? { status: "completed", phase: "final_answer" } : {}),
      internal_chat_message_metadata_passthrough: {
        turn_id: "turn-1",
        content_item_kinds: kinds,
        ...(prov === null ? {} : { content_item_metadata: [{ provenance: prov }] }),
      },
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    },
  };
}

function rolloutLines(sessionId: string, exchanges: readonly [string, string][], opts: { originator?: string; ask?: boolean } = {}): Line[] {
  let n = 0;
  const lines: Line[] = [
    { timestamp: at(n++), type: "session_meta", payload: { session_id: sessionId, id: sessionId, originator: opts.originator ?? "codex-tui", source: "vscode", cli_version: "0.167.0", model: null, cwd: project } },
    { timestamp: at(n++), type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
    msg("developer", "You are Codex, a coding agent. (invented harness text)", ["model.base_instructions"], { type: "harness", hook: false }, n++),
    msg("user", "<environment_context><cwd>/somewhere</cwd></environment_context>", ["environments.environment_context"], { type: "harness", hook: false }, n++),
    { timestamp: at(n++), type: "world_state", payload: { full: true, state: {} } },
    { timestamp: at(n++), type: "turn_context", payload: { turn_id: "turn-1", model: MODEL, cwd: project } },
    msg("developer", "WAKE: the shared memory, as the hook injected it", ["hooks.additional_context"], { type: "harness", hook: true }, n++),
  ];
  for (const [said, answered] of exchanges) {
    lines.push(msg("user", said, ["user.text"], { type: "user" }, n++));
    lines.push(msg("developer", "RECALL: what came to mind", ["hooks.additional_context"], { type: "harness", hook: true }, n++));
    lines.push(msg("assistant", answered, ["unknown"], null, n++));
    lines.push({ timestamp: at(n++), type: "token_usage_record", payload: { turn_id: "turn-1" } });
  }
  if (opts.ask === true) {
    lines.push(msg("user", `<hook_prompt hook_run_id="stop:1">${CODEX_STOP_OPENER} 1) hand back …</hook_prompt>`, ["unknown"], { type: "harness", hook: true }, n++));
    lines.push(msg("assistant", "Done.", ["unknown"], null, n++));
  }
  lines.push({ timestamp: at(n++), type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1" } });
  return lines;
}

function writeRollout(sessionId: string, lines: readonly Line[]): string {
  const dir = join(codexHome, "sessions", "2026", "11", "09");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `rollout-2026-11-09T15-45-14-${sessionId}.jsonl`);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return path;
}

const EXCHANGES: [string, string][] = [
  ["Let's rename the parser module to tokenizer.", "Renamed; the imports are updated."],
  ["Run the lint step on the tokenizer.", "Lint passes with two warnings."],
  ["Fix the two warnings please.", "Both fixed: an unused import and a shadowed name."],
  ["Write a short note on why we renamed it.", "The parser only ever tokenized; the new name says what it does."],
  ["Add a changelog line for the rename.", "Added under Unreleased."],
  ["Bump the minor version too.", "Bumped to the next minor."],
  ["Run the full tokenizer tests once more.", "All green."],
];

async function hook(payload: Record<string, unknown>, extraEnv: Record<string, string> = {}): Promise<{ outcome: string; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const r = await runCodexHook(payload, env(extraEnv) as NodeJS.ProcessEnv, [], { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) }, spawner);
  return { outcome: r.outcome, stdout, stderr };
}

const base = (event: string, sessionId: string, transcript: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  session_id: sessionId,
  ...(transcript === null ? {} : { transcript_path: transcript }),
  cwd: project,
  hook_event_name: event,
  model: MODEL,
  permission_mode: "default",
  ...extra,
});

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

// ── the transcript ──────────────────────────────────────────────────────────

describe("the rollout reader", () => {
  test("conversation in, Codex's own text out: developer messages and harness blocks are not turns, our ask comes home as ritual", () => {
    const raw = rolloutLines("s-read", EXCHANGES.slice(0, 2), { ask: true }).map((l) => JSON.stringify(l)).join("\n");
    const t = parseCodexTranscript(`${raw}\nnot json\n`);
    expect(t.model).toBe(MODEL);
    expect(t.originator).toBe("codex-tui");
    expect(t.corrupt).toBe(1);
    const roles = t.turns.map((x) => `${x.role}:${x.source}`);
    expect(roles).toEqual(["user:conversation", "assistant:conversation", "user:conversation", "assistant:conversation", "user:ritual", "assistant:conversation"]);
    expect(t.turns.some((x) => x.text.includes("WAKE") || x.text.includes("RECALL") || x.text.includes("environment_context"))).toBe(false);
    expect(CODEX_STOP_OPENER_WORDS).toBe(CODEX_STOP_OPENER);
  });
});

// ── the four hooks, through the entry ─────────────────────────────────────

describe("the hooks", () => {
  test("SessionStart wakes with the identity frame, and the session is Codex's", async () => {
    const r = await hook(base("SessionStart", "cx-wake", null, { source: "startup" }));
    expect(r.outcome).not.toBe("config-refused");
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx.startsWith("[Counterparts in Codex]")).toBe(true);
    expect(ctx).toContain(`read here by you, ${MODEL} in Codex`);
    expect(ctx).toContain("You are not that counterpart: its self page is shown for history, not yours to speak as, and \"I\" and \"me\" in what follows are the counterpart.");
    expect(ctx).toContain(`write as yourself (${MODEL} in Codex)`);
    const rec = readSession(store, "cx-wake");
    expect(rec?.host).toBe(CODEX_HOST);
    expect(rec?.model).toBe(MODEL);
  });

  test("the real entry, as a process: SessionStart prints one JSON object Codex reads, and exits 0", () => {
    const r = spawnSync(process.execPath, ["run", HOOK], {
      input: JSON.stringify(base("SessionStart", "cx-proc", null, { source: "startup" })),
      encoding: "utf8",
      env: { ...env(), BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("[Counterparts in Codex]");
  });

  test("UserPromptSubmit recalls a memory the prompt names", async () => {
    const s = openServer({ dir: store, scope: canonicalScope(project) });
    let id: string;
    try {
      id = (await s.call("remember", { text: "The heronfeather build flag turns on the slow path." })).structuredContent["id"] as string;
    } finally {
      s.counterpart.close();
    }
    await hook(base("SessionStart", "cx-recall", null, { source: "startup" }));
    const r = await hook(base("UserPromptSubmit", "cx-recall", null, { prompt: "what does heronfeather do?", turn_id: "t1" }));
    const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain(id);
  });

  test("Stop captures every turn through the cursor, asks in the model's own voice, and the re-fire asks nothing", async () => {
    const sid = "cx-stop";
    const scope = canonicalScope(project);
    await hook(base("SessionStart", sid, null, { source: "startup" }));
    const path = writeRollout(sid, rolloutLines(sid, EXCHANGES.slice(0, 1)));
    await hook(base("Stop", sid, path, { stop_hook_active: false, turn_id: "t1", last_assistant_message: "x" }));
    const c1 = Counterpart.open({ dir: store, observer: true });
    const first = c1.spans.cursor(scope, sid);
    c1.close();
    expect(first).toBeGreaterThan(0);

    writeRollout(sid, rolloutLines(sid, EXCHANGES, {}));
    const r = await hook(base("Stop", sid, path, { stop_hook_active: false, turn_id: "t2", last_assistant_message: "x" }));
    const c2 = Counterpart.open({ dir: store, observer: true });
    const second = c2.spans.cursor(scope, sid);
    const texts = c2.spans.spans(scope).filter((x) => x.session === sid).map((x) => x.text).join("\n");
    c2.close();
    expect(second).toBeGreaterThan(first);
    expect(texts).toContain("tokenizer");
    expect(texts).not.toContain("WAKE");
    expect(spawned).toBeGreaterThan(0);
    // The ask: Codex's measured shape, the session named, the model's own voice.
    const ask = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(ask.decision).toBe("block");
    expect(ask.reason).toContain(`session_end tool, session: ${sid}`);
    expect(ask.reason).toContain(`Write as yourself, ${MODEL} in Codex, not as the counterpart`);
    expect(ask.reason).toContain(`as ${MODEL} in Codex`);
    // The re-fire, with our ask now in the transcript as a hook prompt: nothing out, and the ask is not captured.
    writeRollout(sid, rolloutLines(sid, EXCHANGES, { ask: true }));
    const again = await hook(base("Stop", sid, path, { stop_hook_active: true, turn_id: "t2", last_assistant_message: "Done." }));
    expect(again.stdout).toBe("");
    const c3 = Counterpart.open({ dir: store, observer: true });
    const all = c3.spans.spans(scope).filter((x) => x.session === sid).map((x) => x.text).join("\n");
    c3.close();
    expect(all).not.toContain(CODEX_STOP_OPENER);
  });

  test("SessionEnd tolerates an empty session: no transcript, or one with no turns", async () => {
    const none = await hook(base("SessionEnd", "cx-empty", join(codexHome, "sessions", "nope.jsonl"), { reason: "other" }));
    expect(none.stdout).toBe("");
    expect(none.outcome).not.toBe("failed");
    const path = writeRollout("cx-empty2", rolloutLines("cx-empty2", []));
    const empty = await hook(base("SessionEnd", "cx-empty2", path, { reason: "other" }));
    expect(empty.stdout).toBe("");
    expect(empty.outcome).not.toBe("failed");
    // No transcript at all, either.
    const bare = await hook(base("SessionEnd", "cx-empty3", null, { reason: "other" }));
    expect(bare.outcome).not.toBe("failed");
  });
});

// ── the stand-down (CX2 addendum 2) ────────────────────────────────────────

describe("a Codex that Claude Code started stands down", () => {
  test("by the plugin's environment: nothing out, nothing recorded, one line said", async () => {
    const r = await hook(base("SessionStart", "cx-plugin", null, { source: "startup" }), { CODEX_COMPANION_SESSION_ID: "abc" });
    expect(r.outcome).toBe("inside-claude-code");
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("stood down");
    expect(readSession(store, "cx-plugin")).toBeNull();
    // Claude Code's own session marker does the same.
    const cc = await hook(base("UserPromptSubmit", "cx-plugin", null, { prompt: "hello" }), { CLAUDECODE: "1" });
    expect(cc.outcome).toBe("inside-claude-code");
  });

  test("by the rollout's originator, when the environment did not carry it", async () => {
    const sid = "cx-orig";
    const path = writeRollout(sid, rolloutLines(sid, EXCHANGES, { originator: "Claude Code" }));
    const r = await hook(base("Stop", sid, path, { stop_hook_active: false }));
    expect(r.outcome).toBe("inside-claude-code");
    expect(r.stdout).toBe("");
    const c = Counterpart.open({ dir: store, observer: true });
    expect(c.spans.cursor(canonicalScope(project), sid)).toBe(0);
    c.close();
  });

  test("the two signals as functions, and a plain session is the person's", () => {
    expect(codexStandDown({}, "codex-tui")).toBeNull();
    expect(codexStandDown({}, "codex_exec")).toBeNull();
    expect(codexStandDown({ CODEX_COMPANION_SESSION_ID: "x" }, undefined)).toEqual({ by: "env", marker: "CODEX_COMPANION_SESSION_ID" });
    expect(codexStandDown({ CLAUDE_CODE_ENTRYPOINT: "cli" }, undefined)?.by).toBe("env");
    expect(codexStandDown({}, "claude_code")).toEqual({ by: "originator", originator: "claude_code" });
  });
});

// ── the MCP door, served as Codex ────────────────────────────────────────

describe("the memory server, launched --host codex", () => {
  test("the launch flag is read, and only for a host this build names", () => {
    expect(launchOptions(["--host", "codex"], {}).host).toBe(CODEX_HOST);
    expect(launchOptions(["--host", "claude-desktop"], {}).host).toBeUndefined();
    expect(CODEX_INSTRUCTIONS.length).toBeLessThanOrEqual(512);
  });

  test("self_page writes are refused; reading it still answers; dream, reflect and meet refuse", async () => {
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      const w = await s.call("self_page", { body: "I am someone else now." });
      expect(w.isError).toBe(true);
      expect(w.structuredContent["reason"]).toBe("reader-host");
      const read = await s.call("self_page", {});
      expect(read.structuredContent["reason"]).not.toBe("reader-host");
      for (const tool of ["dream", "reflect", "meet"]) {
        expect((await s.call(tool, { phase: "launch" })).structuredContent["reason"]).toBe("reader-host");
      }
    } finally {
      s.counterpart.close();
    }
  });

  test("memories written from Codex carry the host and the model", async () => {
    await hook(base("SessionStart", "cx-tag", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      const out = await s.call("session_end", { session: "cx-tag", memories: [{ content: "The tokenizer rename landed with the lint fixes.", kind: "fact", about: "work" }] });
      const id = ((out.structuredContent["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>)["id"] as string;
      const row = s.counterpart.store.row(id);
      expect(row?.model).toBe(MODEL);
      expect((JSON.parse(row?.meta ?? "{}") as Record<string, unknown>)["host"]).toBe(CODEX_HOST);
      expect(row?.about).toBe("work");
    } finally {
      s.counterpart.close();
    }
  });
});

// ── CX2 addendum 1: a Codex `me` is the model's own note ─────────────────

describe("about: me from Codex is the model's own self-note, never identity", () => {
  test("kept, labelled, recallable — and out of the self page, beliefs and page stories", async () => {
    await hook(base("SessionStart", "cx-me", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      // A belief to try to file support to, born from an ordinary memory.
      const ordinary = (await s.call("session_end", { session: "cx-me", memories: [{ content: "The owner likes small reviewable diffs.", kind: "fact", about: "owner", saidBy: "owner" }] })).structuredContent;
      const ordinaryId = ((ordinary["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>)["id"] as string;

      const r = await s.call("remember", {
        session: "cx-me",
        text: "I tend to over-explain quillwort refactors before doing them.",
        about: "me",
        belief: { statement: "I over-explain." },
        traits: [{ axis: "agreeable-candid", toward: "candid", strength: 0.4 }],
        story: true,
      });
      const id = r.structuredContent["id"] as string;
      expect(typeof id).toBe("string");
      expect((r.structuredContent["about"] as Record<string, unknown>)["reason"]).toBe("reader-self-note");
      expect((r.structuredContent["belief"] as Record<string, unknown>)["stored"]).toBe(false);
      expect((r.structuredContent["story"] as Record<string, unknown>)["stored"]).toBe(false);

      const c = s.counterpart;
      const row = c.store.row(id);
      expect(row?.about ?? null).toBeNull();
      expect(row?.model).toBe(MODEL);
      expect(readerSelfOfRow(row)).toEqual({ host: CODEX_HOST, model: MODEL });
      // Never a self-page (core) candidate, and no page-story head start.
      expect(aboutMe(c.store, { id, kind: row?.kind ?? "fact", about: row?.about ?? null })).toBe(false);
      expect(storyHeadStart(row?.about ?? null, true)).toBe(0);
      // No later road marks it me or us: the reflection's, a re-mark's.
      let threw: unknown = null;
      try {
        c.store.setAbout(id, "me", { by: "reflection" });
      } catch (err) {
        threw = err;
      }
      expect(isStoreError(threw, "ABOUT_READER_SELF")).toBe(true);
      const remarked = c.markAbout({ id, mark: "us", by: "self" });
      expect(remarked.ok ? null : remarked.reason).toBe("reader-self-note");
      // Never a belief's evidence, by the one door support comes through.
      const belief = c.sessionBelief({ memoryId: ordinaryId, statement: "They prefer small diffs." });
      expect(belief.id).not.toBeNull();
      if (belief.id !== null) {
        const filed = c.schemas.fileSupport({ beliefId: belief.id, memoryId: id, stance: "support", day: c.store.livedDay() });
        expect(filed.reason).toBe("reader-self-note");
      }
      // And recall still finds it.
      const found = await s.call("recall", { question: "quillwort refactors", mode: "facts" });
      expect(JSON.stringify(found.structuredContent)).toContain(id);
    } finally {
      s.counterpart.close();
    }
  });

  test("the same through session_end, and the counterpart's own host is unchanged", async () => {
    await hook(base("SessionStart", "cx-me2", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    let codexId: string;
    try {
      const out = await s.call("session_end", { session: "cx-me2", memories: [{ content: "I like to check the tests twice.", kind: "self", about: "me" }] });
      codexId = ((out.structuredContent["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>)["id"] as string;
      expect(readerSelfOfRow(s.counterpart.store.row(codexId))?.host).toBe(CODEX_HOST);
    } finally {
      s.counterpart.close();
    }
    const cc = openServer({ dir: store, scope: canonicalScope(project) });
    try {
      const mine = await cc.call("remember", { text: "I like the quiet of early mornings.", about: "me" });
      const row = cc.counterpart.store.row(mine.structuredContent["id"] as string);
      expect(row?.about).toBe("me");
      expect(readerSelfOfRow(row)).toBeNull();
    } finally {
      cc.counterpart.close();
    }
  });
});

// ── connect / disconnect / doctor ────────────────────────────────────────

describe("counterparts connect --host codex", () => {
  const ORCA = "/Applications/Orca.app/hook.sh";
  const orcaGroup = (event: string): Record<string, unknown> => ({ hooks: [{ type: "command", command: `${ORCA} ${event}`, timeout: 5 }] });
  const hooksPath = (): string => join(codexHome, "hooks.json");
  const tomlPath = (): string => join(codexHome, "config.toml");

  function seed(): void {
    writeFileSync(hooksPath(), JSON.stringify({ hooks: { SessionStart: [orcaGroup("SessionStart")], Stop: [orcaGroup("Stop")], PreToolUse: [orcaGroup("PreToolUse")] } }, null, 2));
    writeFileSync(
      tomlPath(),
      [
        "model = \"some-model\"",
        "",
        "[mcp_servers.other]",
        "command = \"/usr/local/bin/other\"",
        "",
        "[hooks.state]",
        "",
        `[hooks.state."${hooksPath()}:session_start:0:0"]`,
        "trusted_hash = \"sha256:aaaa\"",
        "",
      ].join("\n"),
    );
  }

  async function cli(verb: "connect" | "disconnect"): Promise<{ code: number; said: string }> {
    const c = consoleWith();
    const code = await run([verb, "--host", "codex", "--config", cfg], { io: c.io, env: env(), home });
    return { code, said: `${c.out.join("\n")}\n${c.err.join("\n")}` };
  }

  test("connect writes four hooks after everyone else's and the MCP entry; again changes nothing; disconnect takes only ours", async () => {
    seed();
    const r = await cli("connect");
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("/hooks");
    const doc = JSON.parse(readFileSync(hooksPath(), "utf8")) as { hooks: Record<string, Record<string, unknown>[]> };
    // Orca's groups first, untouched; ours appended last.
    expect(doc.hooks["SessionStart"]?.[0]).toEqual(orcaGroup("SessionStart"));
    expect(doc.hooks["PreToolUse"]).toEqual([orcaGroup("PreToolUse")]);
    const ours = ourPositions(doc);
    expect(ours.map((p) => p.event).sort()).toEqual(["SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"]);
    expect(ours.find((p) => p.event === "SessionStart")?.group).toBe(1);
    const start = (doc.hooks["SessionStart"]?.[1] as { hooks: Record<string, unknown>[] }).hooks[0] as Record<string, unknown>;
    expect(start["additionalContextLimit"]).toBeGreaterThan(2_500);
    expect(String(start["command"])).toContain("adapters/codex/bin/hook.ts");
    const toml = readFileSync(tomlPath(), "utf8");
    expect(toml).toContain("[mcp_servers.counterparts]");
    expect(toml).toContain("\"--host\", \"codex\"");
    expect(toml).toContain(`COUNTERPARTS_DATA_DIR = ${JSON.stringify(store)}`);
    expect(toml).toContain("[mcp_servers.other]");
    // Nothing here writes a trust hash: only the seeded one is there.
    expect(toml.match(/trusted_hash/g)?.length).toBe(1);
    const stopHook = (doc.hooks["SessionEnd"]?.[0] as { hooks: Record<string, unknown>[] }).hooks[0] as Record<string, unknown>;
    expect(stopHook["timeout"]).toBe(3);
    // One backup of each file this first connect changed.
    const listing = readdirSync(codexHome).sort();
    expect(listing.length).toBe(4);

    // Again: nothing to do — both files byte for byte, no new backup.
    const hooksBytes = readFileSync(hooksPath(), "utf8");
    const tomlBytes = readFileSync(tomlPath(), "utf8");
    const again = await cli("connect");
    expect(again.said).toContain("Codex hooks: already in");
    expect(again.said).toContain("MCP server \"counterparts\": already in");
    expect(readFileSync(hooksPath(), "utf8")).toBe(hooksBytes);
    expect(readFileSync(tomlPath(), "utf8")).toBe(tomlBytes);
    expect(readdirSync(codexHome).sort()).toEqual(listing);

    // Doctor, the command: its Codex lines, through the report.
    const doc1 = consoleWith();
    await run(["doctor", "--config", cfg], { io: doc1.io, env: env(), home });
    expect(doc1.out.join("\n")).toContain("Codex hooks");
    const doc2 = consoleWith();
    await run(["doctor", "--config", cfg, "--json"], { io: doc2.io, env: env(), home });
    expect(doc2.out.join("\n")).toContain("codex.hooks");

    // Doctor: unapproved until the person approves in /hooks; then green.
    const before = codexFindings({ codexHome, codexOnPath: true, cli: "counterparts" });
    expect(before.find((f) => f.key === "codex.hooks")?.severity).toBe("amber");
    expect(before.find((f) => f.key === "codex.mcp")?.severity).toBe("green");
    const approvals = ours.map((p) => `[hooks.state."${stateKey(hooksPath(), p)}"]\ntrusted_hash = "sha256:0123abcd"\n`).join("\n");
    writeFileSync(tomlPath(), `${readFileSync(tomlPath(), "utf8")}\n${approvals}`);
    expect(codexFindings({ codexHome, codexOnPath: true, cli: "counterparts" }).find((f) => f.key === "codex.hooks")?.severity).toBe("green");

    // Disconnect: ours out, Orca's hooks and trust row in, our trust rows gone.
    const d = await cli("disconnect");
    expect(d.code).toBe(EXIT.ok);
    const after = JSON.parse(readFileSync(hooksPath(), "utf8")) as { hooks: Record<string, unknown[]> };
    expect(after.hooks).toEqual({ SessionStart: [orcaGroup("SessionStart")], Stop: [orcaGroup("Stop")], PreToolUse: [orcaGroup("PreToolUse")] });
    const t2 = readFileSync(tomlPath(), "utf8");
    expect(t2).not.toContain("[mcp_servers.counterparts]");
    expect(t2).toContain("[mcp_servers.other]");
    expect(t2).toContain(`${hooksPath()}:session_start:0:0`);
    expect(t2).not.toContain(`${hooksPath()}:session_start:1:0`);
    expect(t2).not.toContain("user_prompt_submit");
    // And again: nothing of ours left, nothing changed.
    const d2 = await cli("disconnect");
    expect(d2.said).toContain("nothing changed");
    expect(codexFindings({ codexHome, codexOnPath: true, cli: "counterparts" })).toEqual([]);
  });

  test("a hooks.json that is not JSON is refused, and nothing changes", async () => {
    writeFileSync(hooksPath(), "{ not json");
    const r = await cli("connect");
    expect(r.code).toBe(EXIT.refused);
    expect(readFileSync(hooksPath(), "utf8")).toBe("{ not json");
    expect(existsSync(tomlPath())).toBe(false);
  });

  test("the merge never moves another tool's group, and reports a shift when one sat after ours", () => {
    const ourCmd = "bun run /pkg/src/adapters/codex/bin/hook.ts";
    const doc = { hooks: { Stop: [{ hooks: [{ type: "command", command: ourCmd }] }, orcaGroup("Stop")] } };
    const out = mergeCodexHooks(doc, ourCmd, "unwire");
    expect(out.doc).toEqual({ hooks: { Stop: [orcaGroup("Stop")] } });
    expect(out.shifted).toEqual(["Stop"]);
  });
});

// ── the delivery and the words ────────────────────────────────────────────

// ── the fix round: config.toml, hooks.json's shape, Windows, uninstall ──────

describe("Codex's files, edited with care (CX2 fix round)", () => {
  const hooksPath = (): string => join(codexHome, "hooks.json");
  const tomlPath = (): string => join(codexHome, "config.toml");
  async function cli(argv: string[]): Promise<{ code: number; said: string }> {
    const c = consoleWith();
    const code = await run(argv, { io: c.io, env: env(), home, spawner: () => ({ missing: false, code: 0, out: "", err: "" }), processes: () => ({ looked: true, processes: [] }) });
    return { code, said: `${c.out.join("\n")}\n${c.err.join("\n")}` };
  }

  test("a reconnect keeps the comment above a later table, and a header inside a multi-line string is words", async () => {
    writeFileSync(tomlPath(), ['notes = """', "[mcp_servers.counterparts]", "kept as written", '"""', ""].join("\n"));
    expect((await cli(["connect", "--host", "codex", "--config", cfg])).code).toBe(EXIT.ok);
    writeFileSync(tomlPath(), `${readFileSync(tomlPath(), "utf8")}\n# note for later\n[mcp_servers.later]\ncommand = "/bin/later"\n`);
    expect((await cli(["connect", "--host", "codex", "--config", cfg])).code).toBe(EXIT.ok);
    const toml = readFileSync(tomlPath(), "utf8");
    expect(toml).toContain("# note for later\n[mcp_servers.later]\ncommand = \"/bin/later\"");
    expect(toml.startsWith('notes = """\n[mcp_servers.counterparts]\nkept as written\n"""')).toBe(true);
    expect(toml.match(/^\[mcp_servers\.counterparts\]$/gm)?.length).toBe(2);
    // Disconnect leaves the later table's comment too, and the string.
    expect((await cli(["disconnect", "--host", "codex", "--config", cfg])).code).toBe(EXIT.ok);
    const after = readFileSync(tomlPath(), "utf8");
    expect(after).toContain("# note for later\n[mcp_servers.later]");
    expect(after).toContain("kept as written");
    expect(after).not.toContain("--host");
  });

  test("a config.toml that does not read as TOML is refused, and neither file changes", async () => {
    writeFileSync(tomlPath(), "model = \"x\"\nthis line is not toml\n");
    writeFileSync(hooksPath(), "{}\n");
    const r = await cli(["connect", "--host", "codex", "--config", cfg]);
    expect(r.code).toBe(EXIT.refused);
    expect(r.said).toContain("line 2");
    expect(r.said).not.toContain("this line is not toml");
    expect(readFileSync(tomlPath(), "utf8")).toBe("model = \"x\"\nthis line is not toml\n");
    expect(readFileSync(hooksPath(), "utf8")).toBe("{}\n");
  });

  test("an unclosed one-line string, or junk after a value, is refused too (re-review)", async () => {
    for (const bad of ['model = "x', "x = 'y", 'k = "a" "b"']) {
      writeFileSync(tomlPath(), `${bad}\n`);
      writeFileSync(hooksPath(), "{}\n");
      const r = await cli(["connect", "--host", "codex", "--config", cfg]);
      expect({ bad, code: r.code }).toEqual({ bad, code: EXIT.refused });
      expect(r.said).toContain("line 1");
      expect(readFileSync(tomlPath(), "utf8")).toBe(`${bad}\n`);
      expect(readFileSync(hooksPath(), "utf8")).toBe("{}\n");
    }
    // And ordinary values still read: a date with its time, an array over lines, a multi-line string.
    expect(tomlProblem('when = 1979-05-27 07:32:00Z\nn = 3\nok = true\nargs = [\n  "a",\n  "b",\n]\ns = """\nx = "\n"""\nt = { a = "1" }\n')).toBeNull();
  });

  test("hooks.json keeps its own indentation", async () => {
    writeFileSync(hooksPath(), `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "/x/other.sh" }] }] } }, null, 4)}\n`);
    await cli(["connect", "--host", "codex", "--config", cfg]);
    const text = readFileSync(hooksPath(), "utf8");
    expect(text).toContain('\n    "hooks": {');
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("on Windows, connect says it is not supported yet and writes nothing", () => {
    const c = consoleWith();
    const out = wireCodex({ io: c.io, env: env(), home, configPath: cfg, custom: true, store, now: Date.now(), platform: "win32" }, "wire");
    expect(out).toBe("refused");
    expect(c.err.join("\n")).toContain("Windows");
    expect(existsSync(hooksPath())).toBe(false);
  });

  test("uninstall takes our Codex hooks and MCP entry out too", async () => {
    writeFileSync(hooksPath(), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "/x/other.sh" }] }] } }));
    await cli(["connect", "--host", "codex", "--config", cfg]);
    const r = await cli(["uninstall", "--config", cfg, "--keep-memories", "--yes"]);
    expect(r.code).toBe(EXIT.ok);
    const doc = JSON.parse(readFileSync(hooksPath(), "utf8")) as Record<string, unknown>;
    expect(ourPositions(doc)).toEqual([]);
    expect(JSON.stringify(doc)).toContain("/x/other.sh");
    expect(readFileSync(tomlPath(), "utf8")).not.toContain("[mcp_servers.counterparts]");
  });
});

// ── the fix round: a reader's own feelings and said-by stay out of the counterpart's ──

describe("whose: self and saidBy: self from Codex are the model's, never the counterpart's", () => {
  test("a strong self 'recognized' never reaches the fast lane, the night's 'my' feelings, or a belief as a choice", async () => {
    await hook(base("SessionStart", "cx-feel", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      // Bound first (a `remember` before any `session_end` records no model, as on every host).
      const ordinary = (await s.call("session_end", { session: "cx-feel", memories: [{ content: "The owner keeps plans short.", kind: "fact", about: "owner", saidBy: "owner" }] })).structuredContent;
      const ordinaryId = ((ordinary["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>)["id"] as string;
      const r = await s.call("remember", {
        session: "cx-feel",
        text: "Seeing the old tokenizer notes, the pattern of over-planning felt familiar.",
        kind: "person",
        saidBy: "self",
        feelings: [
          { whose: "self", emotion: "recognized", strength: 0.95, carried_by: "the old notes" },
          { whose: "owner", emotion: "curious", strength: 0.5 },
        ],
      });
      const id = r.structuredContent["id"] as string;
      expect(typeof id).toBe("string");
      const c = s.counterpart;
      const row = c.store.row(id);
      // The column and the table hold none of it; the meta holds it, labelled.
      expect(row?.said_by ?? null).toBeNull();
      const feelings = c.store.feelingsFor(id);
      expect(feelings.some((f) => f.whose === "self")).toBe(false);
      expect(feelings.some((f) => f.whose === "owner")).toBe(true);
      const meta = JSON.parse(row?.meta ?? "{}") as Record<string, Record<string, unknown>>;
      expect(meta["readerFeelings"]?.["host"]).toBe(CODEX_HOST);
      expect(meta["readerFeelings"]?.["model"]).toBe(MODEL);
      expect(meta["readerSaidBy"]).toEqual({ host: CODEX_HOST, model: MODEL, saidBy: "self" });
      // The fast lane: an unmarked person memory with a strong self recognition would count — this one doesn't.
      expect(selfRelevantFeeling(c.store, { id, kind: row?.kind ?? "person", about: row?.about ?? null }, true)).toBe(false);
      // The night's "my" feelings: nothing of it.
      const weeks = feelingWeeks(c.store, c.store.today(), () => true);
      expect(Object.keys(weeks?.mine ?? {}).length).toBe(0);
      expect(weeks?.restsOn ?? []).not.toContain(id);
      // A belief: filed as found, never as my choice.
      const belief = c.sessionBelief({ memoryId: ordinaryId, statement: "They like short plans." });
      expect(belief.id).not.toBeNull();
      const filed = c.schemas.fileSupport({ beliefId: belief.id as string, memoryId: id, stance: "support", day: c.store.livedDay(), route: "choice" });
      expect(filed.route).not.toBe("choice");
    } finally {
      s.counterpart.close();
    }
  });

  test("the control: the same write from the counterpart's own host is the counterpart's", async () => {
    const s = openServer({ dir: store, scope: canonicalScope(project) });
    try {
      const r = await s.call("remember", {
        text: "Seeing the old tokenizer notes, the pattern of over-planning felt familiar.",
        kind: "person",
        saidBy: "self",
        feelings: [{ whose: "self", emotion: "recognized", strength: 0.95 }],
      });
      const id = r.structuredContent["id"] as string;
      const row = s.counterpart.store.row(id);
      expect(row?.said_by).toBe("self");
      expect(selfRelevantFeeling(s.counterpart.store, { id, kind: row?.kind ?? "person", about: row?.about ?? null }, true)).toBe(true);
    } finally {
      s.counterpart.close();
    }
  });
});

// ── option B (Mike, 2026-11-10): a Codex "us" is the owner and THAT model ──

describe("about: us from Codex is the owner and that model, labelled — never the counterpart's us", () => {
  test("kept and recalled with its label; out of meaning-mode us, the self page, beliefs, page stories and the wake", async () => {
    // The counterpart's own us, from Claude Code, in the same store: the control every check reads beside it.
    const cc = openServer({ dir: store, scope: canonicalScope(project) });
    let ccId: string;
    try {
      const mine = await cc.call("remember", { text: "Mike and I found our rhythm on long walks after dinner.", about: "us", kind: "person" });
      ccId = mine.structuredContent["id"] as string;
      expect(cc.counterpart.store.row(ccId)?.about).toBe("us");
    } finally {
      cc.counterpart.close();
    }

    await hook(base("SessionStart", "cx-us", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      // Bound first, so the label carries the model.
      const ordinary = (await s.call("session_end", { session: "cx-us", memories: [{ content: "The owner keeps reviews small.", kind: "fact", about: "owner", saidBy: "owner" }] })).structuredContent;
      const ordinaryId = ((ordinary["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>)["id"] as string;

      const r = await s.call("remember", {
        session: "cx-us",
        text: "Pairing on the heronfeather tokenizer, the owner and I settle disputes by running the benchmark.",
        about: "us",
        kind: "person",
        belief: { statement: "We settle things with data.", about: "us" },
      });
      const id = r.structuredContent["id"] as string;
      expect(typeof id).toBe("string");
      expect((r.structuredContent["about"] as Record<string, unknown>)["reason"]).toBe("reader-us-note");
      // No belief from Codex, `us` or not.
      expect((r.structuredContent["belief"] as Record<string, unknown>)["stored"]).toBe(false);
      expect((r.structuredContent["belief"] as Record<string, unknown>)["reason"]).toBe("reader-host");

      const c = s.counterpart;
      const row = c.store.row(id);
      // Stored, with no `us` mark; labelled in the meta the way its feelings and said-by are.
      expect(row?.about ?? null).toBeNull();
      expect(row?.model).toBe(MODEL);
      expect(readerUsOfRow(row)).toEqual({ host: CODEX_HOST, model: MODEL });
      expect(readerSelfOfRow(row)).toBeNull();
      expect((JSON.parse(row?.meta ?? "{}") as Record<string, unknown>)["readerUs"]).toEqual({ host: CODEX_HOST, model: MODEL });

      // Recall finds it, with the label.
      const found = await s.call("recall", { question: "heronfeather tokenizer benchmark disputes", mode: "facts" });
      const answer = String(found.structuredContent["answer"]);
      expect(found.structuredContent["ids"] as string[]).toContain(id);
      expect(answer).toContain(`${MODEL} in Codex's own note about itself and the owner — not about us`);

      // Meaning-mode "us" (the relationship arc): the counterpart's us, never Codex's.
      const arc = await s.call("recall", { question: "how have the two of us been together lately?", mode: "meaning" });
      const arcIds = arc.structuredContent["ids"] as string[];
      expect(arcIds).toContain(ccId);
      expect(arcIds).not.toContain(id);

      // The self page's writer: never a core candidate, no page-story head start.
      expect(aboutMe(c.store, { id, kind: row?.kind ?? "person", about: row?.about ?? null })).toBe(false);
      expect(storyHeadStart(row?.about ?? null, true)).toBe(0);
      const ccRow = c.store.row(ccId);
      expect(aboutMe(c.store, { id: ccId, kind: ccRow?.kind ?? "person", about: ccRow?.about ?? null })).toBe(true);

      // No later road marks it me or us: the reflection's, a re-mark's.
      let threw: unknown = null;
      try {
        c.store.setAbout(id, "us", { by: "reflection" });
      } catch (err) {
        threw = err;
      }
      expect(isStoreError(threw, "ABOUT_READER_SELF")).toBe(true);
      const remarked = c.markAbout({ id, mark: "us", by: "self" });
      expect(remarked.ok ? null : remarked.reason).toBe("reader-self-note");

      // Never a belief's evidence.
      const belief = c.sessionBelief({ memoryId: ordinaryId, statement: "They like small reviews." });
      expect(belief.id).not.toBeNull();
      const filed = c.schemas.fileSupport({ beliefId: belief.id as string, memoryId: id, stance: "support", day: c.store.livedDay() });
      expect(filed.reason).toBe("reader-self-note");

      // The wake's us lines ("Since the last night"): the counterpart's, not Codex's.
      const news = c.store.aboutUsWrittenSince(0, Number.MAX_SAFE_INTEGER, 50).map((x) => x.id);
      expect(news).toContain(ccId);
      expect(news).not.toContain(id);

      // The self page's writer is never handed it; the counterpart's own us it is.
      const handed = c.pageWriterInput({ about: c.store.today() });
      const statements = handed.memories.map((m) => m.statement);
      expect(statements).toContain("Mike and I found our rhythm on long walks after dinner.");
      expect(statements.some((x) => x.includes("heronfeather"))).toBe(false);
      expect(handed.omitted).toBe(1);
      // The whole wake, as a fresh session gets it (the shaped composer): none of Codex's us words.
      c.store.setMeta(WAKE_SHAPE_KEY, "on");
      const woke = await hook(base("SessionStart", "cx-us-wake", null, { source: "startup" }));
      expect(woke.stdout).toContain("counterparts:wake/end");
      expect(woke.stdout).not.toContain("heronfeather");

      // And Codex cannot re-mark the counterpart's own memory about us either.
      const rm = await s.call("remember", { session: "cx-us", remark: { id: ccId, about: "us", why: "it is ours" } });
      expect((rm.structuredContent["remark"] as Record<string, unknown>)["reason"]).toBe("reader-host");

      // The label wherever the note surfaces: the meaning-mode arc, and the hook's ambient recall.
      const byWords = await s.call("recall", { question: "what happened with heronfeather?", mode: "meaning" });
      expect(byWords.structuredContent["ids"] as string[]).toContain(id);
      expect(String(byWords.structuredContent["answer"])).toContain(`${MODEL} in Codex's own note about itself and the owner — not about us`);
      await hook(base("SessionStart", "cx-us-amb", null, { source: "startup" }));
      const ambient = await hook(base("UserPromptSubmit", "cx-us-amb", null, { prompt: "what does heronfeather do?", turn_id: "t1" }));
      expect(ambient.stdout).toContain(id);
      expect(ambient.stdout).toContain(`${MODEL} in Codex's own note about itself and the owner — not about us`);

      // A Codex revision of the counterpart's us memory is not taken: the counterpart's memory keeps its
      // strength, stays live and stays in meaning-mode us; Codex's words stand as its own us note.
      const day = c.store.livedDay();
      const before = strength(c.store.physicsOf(ccId) as NonNullable<ReturnType<typeof c.store.physicsOf>>, day);
      const rev = await s.call("remember", { session: "cx-us", updates: ccId, how: "changed", text: "Mike and I found our rhythm on long walks after dinner, and on Sunday mornings too.", kind: "person" });
      const revId = rev.structuredContent["id"] as string;
      expect(rev.structuredContent["settled"]).toBeUndefined();
      expect((rev.structuredContent["updatesNotTaken"] as Record<string, unknown>)["over"]).toBe(ccId);
      expect((rev.structuredContent["updatesNotTaken"] as Record<string, unknown>)["reason"]).toBe("counterpart-identity");
      expect(c.store.row(revId)?.about ?? null).toBeNull();
      expect(readerUsOfRow(c.store.row(revId))).toEqual({ host: CODEX_HOST, model: MODEL });
      expect((rev.structuredContent["about"] as Record<string, unknown>)["reason"]).toBe("reader-us-note");
      const after = c.store.row(ccId);
      expect(after?.superseded_by ?? null).toBeNull();
      expect(after?.archived).toBe(0);
      expect(after?.about).toBe("us");
      expect(strength(c.store.physicsOf(ccId) as NonNullable<ReturnType<typeof c.store.physicsOf>>, day)).toBe(before);
      const arcAfter = await s.call("recall", { question: "how have the two of us been together lately?", mode: "meaning" });
      expect(arcAfter.structuredContent["ids"] as string[]).toContain(ccId);
      expect(arcAfter.structuredContent["ids"] as string[]).not.toContain(revId);
    } finally {
      s.counterpart.close();
    }
  });

  test("a Codex note never blocks the counterpart's own write of the same words, in one store; the reverse stays a repeat", async () => {
    const words = "The owner and I always celebrate a green build with a short walk.";
    await hook(base("SessionStart", "cx-dup", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      await s.call("session_end", { session: "cx-dup", memories: [{ content: "The owner keeps reviews small.", kind: "fact", about: "owner" }] });
      const r = await s.call("remember", { session: "cx-dup", text: words, about: "us", kind: "person" });
      expect(readerUsOfRow(s.counterpart.store.row(r.structuredContent["id"] as string))).not.toBeNull();
    } finally {
      s.counterpart.close();
    }
    const cc = openServer({ dir: store, scope: canonicalScope(project) });
    let ccId: string;
    try {
      const mine = await cc.call("remember", { text: words, about: "us", kind: "person" });
      expect(mine.structuredContent["stored"]).toBe(true);
      ccId = mine.structuredContent["id"] as string;
      const row = cc.counterpart.store.row(ccId);
      expect(row?.about).toBe("us");
      expect(readerUsOfRow(row)).toBeNull();
    } finally {
      cc.counterpart.close();
    }
    // Codex repeating the counterpart's words is still a repeat.
    const again = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      const echo = await again.call("remember", { session: "cx-dup", text: "Mike and I keep Friday afternoons for the garden.", about: "us", kind: "person" });
      expect(echo.structuredContent["stored"]).toBe(true);
    } finally {
      again.counterpart.close();
    }
    const cc2 = openServer({ dir: store, scope: canonicalScope(project) });
    try {
      await cc2.call("remember", { text: "We keep Sunday mornings for long breakfasts together.", about: "us", kind: "person" });
    } finally {
      cc2.counterpart.close();
    }
    const again2 = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      const dup = await again2.call("remember", { session: "cx-dup", text: "We keep Sunday mornings for long breakfasts together.", about: "us", kind: "person" });
      expect(dup.structuredContent["reason"]).toBe("duplicate-content");
    } finally {
      again2.counterpart.close();
    }
  });

  test("the same through session_end; a chapter's us is dropped; and the counterpart's own us from Claude Code is unchanged", async () => {
    await hook(base("SessionStart", "cx-us2", null, { source: "startup" }));
    const s = openServer({ dir: store, host: CODEX_HOST, scope: canonicalScope(project) });
    try {
      const out = await s.call("session_end", { session: "cx-us2", memories: [{ content: "The owner and I like to review diffs side by side.", kind: "person", about: "us" }] });
      const outcome = (out.structuredContent["outcomes"] as Record<string, unknown>[])[0] as Record<string, unknown>;
      const codexId = outcome["id"] as string;
      const row = s.counterpart.store.row(codexId);
      expect(row?.about ?? null).toBeNull();
      expect(readerUsOfRow(row)).toEqual({ host: CODEX_HOST, model: MODEL });
      expect((outcome["about"] as Record<string, unknown>)["reason"]).toBe("reader-us-note");
      const ch = await s.call("chapter", { session: "cx-us2", text: "We reviewed the tokenizer diff side by side.", about: "us" });
      expect(ch.structuredContent["stored"]).toBe(true);
      expect(ch.structuredContent["about"]).toBeUndefined();
      expect((ch.structuredContent["aboutDropped"] as Record<string, unknown>)["mark"]).toBe("us");
    } finally {
      s.counterpart.close();
    }
    // The same words from Claude Code, in the same store: the counterpart's own us.
    const cc = openServer({ dir: store, scope: canonicalScope(project) });
    try {
      const mine = await cc.call("remember", { text: "The owner and I like to review diffs side by side.", about: "us", kind: "person" });
      expect((mine.structuredContent["about"] as Record<string, unknown>)["mark"]).toBe("us");
      const row = cc.counterpart.store.row(mine.structuredContent["id"] as string);
      expect(row?.about).toBe("us");
      expect(readerUsOfRow(row)).toBeNull();
      expect(aboutMe(cc.counterpart.store, { id: row?.id ?? "", kind: row?.kind ?? "person", about: row?.about ?? null })).toBe(true);
    } finally {
      cc.counterpart.close();
    }
  });
});

describe("the envelope", () => {
  test("only the measured shapes", () => {
    expect(codexDelivery("session-start", { injection: "x", ask: null }, {})).toBe(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "x" } }));
    expect(codexDelivery("stop", { injection: "", ask: "ask" }, {})).toBe(JSON.stringify({ decision: "block", reason: "ask" }));
    expect(codexDelivery("stop", { injection: "", ask: "ask" }, { stop_hook_active: true })).toBe("");
    expect(codexDelivery("session-end", { injection: "x", ask: "y" }, {})).toBe("");
    expect(codexStopAsk("s1", 3, undefined)).toContain("a model in Codex");
  });
});

// ── import direction ───────────────────────────────────────────────────────

describe("adapters/codex is a sibling, not a fork", () => {
  test("its library files import no other adapter (only its entry point borrows Claude Code's readers)", () => {
    const dir = resolve(import.meta.dir, "../src/adapters/codex");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(join(dir, f), "utf8");
      expect({ f, bad: /from "\.\.\/(claude-code|mcp|cli|dashboard|remote)\//.test(text) }).toEqual({ f, bad: false });
    }
  });
});
