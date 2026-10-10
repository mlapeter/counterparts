/**
 * THE NIGHT NOTICES IF THE HOST CUT ITS RESULTS (2026-10-09, U14 item 3).
 *
 * 0.3.12 keeps every counterparts tool result under 40,000 characters, but
 * Claude Code's own line (50,000 today) can be lowered by a remote flag, and a
 * result past it reaches the model as a 2 KB preview. Nothing in the store can
 * see that. The nightly run now names its child's session (`--session-id`),
 * reads that child's transcript once it exits, and:
 *
 *   - counts a result of ours the host replaced with its marker — matched where
 *     the host puts it, never as a substring (the morning of 10-09 a search for
 *     "Output too large" found two memories quoting the check itself);
 *   - writes one `mcp.result.spilled` row per cut result, and the count on the
 *     run's row;
 *   - doctor's Tool results line goes amber; the morning hand-back says it.
 *
 * Plus the reflection's instructions: when its bundle comes in parts, they say
 * to read every part first (a release-check reflection finished without part 2).
 *
 * Hermetic: a fresh temp data dir and a fresh temp host directory per test,
 * removed after. No process is started; the child is an injected starter that
 * writes a fixture transcript where the host would.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hostConfigDir,
  hostTranscriptPath,
  openAdapter,
  openNightCounterpart,
  parseToolSpills,
  planNightChild,
  readToolSpills,
  runNight,
  spillOf,
} from "../src/adapters/claude-code/index.js";
import type { AdapterConfig, ChildPlan, HookInput } from "../src/adapters/claude-code/index.js";
import { resultFindings } from "../src/adapters/claude-code/doctor.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart, MCP_PART_EVENT, MCP_SPILLED_EVENT } from "../src/core/counterpart.js";
import { nightRunOf } from "../src/core/dream/index.js";
import type { NightRun } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
let host: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-spill-"));
  host = mkdtempSync(join(tmpdir(), "counterparts-spill-host-"));
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
  rmSync(host, { recursive: true, force: true });
});

// ── a transcript, as the host writes one ────────────────────────────────────

const DREAM = "mcp__counterparts__dream";
const REFLECT = "mcp__counterparts__reflect";
const RECALL = "mcp__counterparts__recall";

function call(id: string, name: string, input: Record<string, unknown>): string {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
}

/** A result, recorded the way the host records one: in the message, and its own copy beside it. */
function answer(id: string, content: unknown): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] }, toolUseResult: content });
}

function said(role: "user" | "assistant", text: string): string {
  return JSON.stringify({ type: role, message: { role, content: [{ type: "text", text }] } });
}

// The four markers, as Claude Code 2.1.295 writes them in place of a result.
const persisted = (size: string): string =>
  `<persisted-output>\nOutput too large (${size}). Full output saved to: /home/someone/.claude/projects/-store/0d5c/tool-results/mcp-counterparts-dream-1.txt\n\nPreview (first 2KB):\n{"phase":"begin","dream":"drm_1","bundle":"⟦dream⟧ the bundle goes on\n...\n</persisted-output>`;
const capped =
  "<persisted-output>\nOutput exceeded the 64MB persist limit; only the first 64MB were saved to: /x/tool-results/a.txt\n\nPreview (first 2KB):\n{\"phase\":\"part\"\n...\n</persisted-output>";
const unsaved =
  "<truncated-output>\nOutput too large (51.7KB). It could not be saved, so only the first 2KB are shown; the rest was dropped. If the tool can page or filter its results, call it again for the part you need.\n</truncated-output>";
const tokens =
  "Error: result (51,306 characters) exceeds maximum allowed tokens. Output has been saved to /x/tool-results/mcp-counterparts-dream-2.txt.\nFormat: JSON with schema: {phase: string}\nUse jq to make structured queries.";
const tokenCut = (head: string): string =>
  `${head}\n\n[OUTPUT TRUNCATED - exceeded 25000 token limit]\n\nThe tool output was truncated. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data. If pagination is not available, inform the user that you are working with truncated output and results may be incomplete.`;

/**
 * THE MORNING'S FALSE POSITIVE, as it was: a recall answer whose memories
 * QUOTE the check — "Output too large", the size, the saved-file sentence,
 * even the opening tag and the token trailer — inside our own result's JSON.
 */
const quotingRecall = JSON.stringify({
  phase: "facts",
  memories: [
    {
      id: "mem_q1",
      body: 'Checked last night\'s transcript for "Output too large" on the dream and reflect calls: none this time. On 10-07 the dream began with <persisted-output>\nOutput too large (51.5KB). Full output saved to: …/tool-results/x.txt',
    },
    { id: "mem_q2", body: "Output too large (52.1KB). Full output saved to: the tool-results folder — the reflection's part 1, which the run could not open." },
    {
      id: "mem_q3",
      body: "What the host appends when it keeps no file:\n\n[OUTPUT TRUNCATED - exceeded 25000 token limit]\n\nThe tool output was truncated. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data. If pagination is not available, inform the user that you are working with truncated output and results may be incomplete.",
    },
  ],
});

/** A night: the dream's begin cut by the host, its part whole, the reflection whole. */
function spilledNight(): string {
  return [
    said("user", "the launch prompt"),
    call("toolu_1", DREAM, { phase: "begin", session: "s1" }),
    answer("toolu_1", persisted("51.5KB")),
    call("toolu_2", DREAM, { phase: "part", dream: "drm_1", part: 2 }),
    answer("toolu_2", [{ type: "text", text: '{"phase":"part","part":2,"of":2}' }]),
    call("toolu_3", REFLECT, { phase: "begin", session: "s1" }),
    answer("toolu_3", '{"phase":"begin","reflection":"rfl_1"}'),
    said("assistant", "Done."),
  ].join("\n");
}

// ── 1. the marker, where the host puts it ───────────────────────────────────

describe("the host's marker is matched where the host puts it, on our results only", () => {
  test("each of the four shapes, as a string and as a block list; the size the host said is kept, the saved file's path is not", () => {
    expect(spillOf(persisted("51.5KB"))).toEqual({ shape: "persisted", said: "51.5KB" });
    expect(spillOf([{ type: "text", text: persisted("52.1KB") }])).toEqual({ shape: "persisted", said: "52.1KB" });
    expect(spillOf(capped)).toEqual({ shape: "persisted", said: null });
    expect(spillOf(unsaved)).toEqual({ shape: "unsaved", said: "51.7KB" });
    expect(spillOf(tokens)).toEqual({ shape: "tokens", said: "51,306 characters" });
    expect(spillOf(tokenCut('{"phase":"begin","bundle":"cut sho'))).toEqual({ shape: "token-cut", said: null });
    // The block form of the token cut: the trailer is a block of its own, last.
    expect(spillOf([{ type: "text", text: '{"phase":"begin"' }, { type: "text", text: tokenCut("").slice(0) }])).toEqual({ shape: "token-cut", said: null });
    expect(spillOf('{"phase":"begin","dream":"drm_1"}')).toBeNull();
    expect(spillOf([])).toBeNull();
    expect(spillOf(undefined)).toBeNull();
    for (const s of parseToolSpills([call("t", DREAM, { phase: "begin" }), answer("t", persisted("51.5KB"))].join("\n")).spills) {
      expect(JSON.stringify(s)).not.toContain("tool-results");
    }
  });

  test("THE MORNING'S CASE: memories quoting the check inside a recall answer are two hits for a substring search and zero spills", () => {
    const raw = [
      call("toolu_r", RECALL, { mode: "facts", question: "did the night spill" }),
      answer("toolu_r", quotingRecall),
      // The same answer, as a block list.
      call("toolu_s", RECALL, { mode: "facts", question: "again" }),
      answer("toolu_s", [{ type: "text", text: quotingRecall }]),
    ].join("\n");
    // What the manual check did: a substring search. It finds them.
    expect(raw.split("Output too large").length - 1).toBeGreaterThanOrEqual(2);
    expect(raw).toContain("<persisted-output>");
    expect(raw).toContain("[OUTPUT TRUNCATED - exceeded 25000 token limit]");
    // What the night reads: our results, two of them, none cut.
    const read = parseToolSpills(raw);
    expect({ results: read.results, spills: read.spills, corrupt: read.corrupt }).toEqual({ results: 2, spills: [], corrupt: 0 });
    expect(read.whole).toHaveLength(2);
  });

  test("the marker quoted by the model, by the person, or in another tool's result is not one of our results cut", () => {
    const raw = [
      said("assistant", persisted("51.5KB")),
      said("user", `${persisted("60KB")}\nwhat does this mean?`),
      call("toolu_x", "Read", { file_path: "/tmp/big.txt" }),
      answer("toolu_x", persisted("61.4KB")),
      call("toolu_y", "ToolSearch", { query: "select:mcp__counterparts__dream" }),
      answer("toolu_y", tokens),
      // An answer to a call nobody made (a resumed transcript's tail).
      answer("toolu_gone", persisted("51.5KB")),
    ].join("\n");
    expect(parseToolSpills(raw)).toEqual({ results: 0, spills: [], whole: [], corrupt: 0 });
  });

  test("REVIEW OF #330: the per-turn budget's swap is a line of its own — read there, shaped turn-budget, each call counted once", () => {
    // Several parts fetched in one turn: each result's own line stays whole;
    // the host's swap of the largest is written after them, as resume replays it.
    const raw = [
      call("toolu_p2", DREAM, { phase: "part", dream: "drm_1", part: 2 }),
      call("toolu_p3", DREAM, { phase: "part", dream: "drm_1", part: 3 }),
      call("toolu_rd", "Read", { file_path: "/tmp/big.txt" }),
      answer("toolu_p2", '{"phase":"part","part":2,"of":3}'),
      answer("toolu_p3", '{"phase":"part","part":3,"of":3}'),
      answer("toolu_rd", "a file"),
      JSON.stringify({
        type: "content-replacement",
        sessionId: "x",
        replacements: [
          { kind: "tool-result", toolUseId: "toolu_p3", replacement: persisted("39.8KB") },
          // Another tool's swap is not ours; an unknown kind is not a result.
          { kind: "tool-result", toolUseId: "toolu_rd", replacement: persisted("90KB") },
          { kind: "something-else", toolUseId: "toolu_p2", replacement: persisted("39KB") },
        ],
      }),
      // The same swap replayed, and the same result recorded twice: one each.
      JSON.stringify({ type: "content-replacement", replacements: [{ kind: "tool-result", toolUseId: "toolu_p3", replacement: persisted("39.8KB") }] }),
      answer("toolu_p2", '{"phase":"part","part":2,"of":3}'),
    ].join("\n");
    expect(parseToolSpills(raw)).toEqual({
      results: 2,
      spills: [{ tool: DREAM, phase: "part", shape: "turn-budget", said: "39.8KB", part: 3, dream: "drm_1" }],
      // Lane 0 (2026-10-10): part 2 came through whole; part 3 did not.
      whole: [{ tool: DREAM, phase: "part", part: 2, dream: "drm_1" }],
      corrupt: 0,
    });
  });

  test("REVIEW OF #330: the token marker's count as the host's locale writes it", () => {
    expect(spillOf(tokens.replace("51,306", "51.306"))).toEqual({ shape: "tokens", said: "51.306 characters" });
    expect(spillOf(tokens.replace("51,306", "51 306"))).toEqual({ shape: "tokens", said: "51 306 characters" });
    expect(spillOf(tokens.replace("51,306 characters", "51,306 characters across 3 lines"))).toEqual({ shape: "tokens", said: "51,306 characters" });
  });

  test("a night with the dream's begin cut: one spill, named by tool and phase; the rest counted whole", () => {
    const out = parseToolSpills(`${spilledNight()}\nnot json\n[1,2]`);
    expect(out.results).toBe(3);
    expect(out.corrupt).toBe(2);
    expect(out.spills).toEqual([{ tool: DREAM, phase: "begin", shape: "persisted", said: "51.5KB", part: null, dream: null }]);
  });
});

// ── 2. finding the child's transcript ───────────────────────────────────────

describe("the child's transcript is found by the session id the run chose", () => {
  const ID = "0f3c9a52-6d1e-4b7a-9c2d-5e8f1a2b3c4d";

  test("under the directory as the host spells it; failing that, by its name in any project; else null", () => {
    const cwd = join(dir, "store dir");
    mkdirSync(cwd, { recursive: true });
    const projects = join(host, "projects");
    expect(hostTranscriptPath({ configDir: host, id: ID, cwd })).toBeNull();
    mkdirSync(projects, { recursive: true });
    expect(hostTranscriptPath({ configDir: host, id: ID, cwd })).toBeNull();
    // Somewhere the spelling did not predict (a hashed long path, a worktree root).
    mkdirSync(join(projects, "-elsewhere"), { recursive: true });
    writeFileSync(join(projects, "-elsewhere", `${ID}.jsonl`), "", "utf8");
    expect(hostTranscriptPath({ configDir: host, id: ID, cwd })).toBe(join(projects, "-elsewhere", `${ID}.jsonl`));
    // Where the host spells it: every character but a letter or a digit is "-".
    const spelled = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    mkdirSync(join(projects, spelled), { recursive: true });
    writeFileSync(join(projects, spelled, `${ID}.jsonl`), "", "utf8");
    expect(hostTranscriptPath({ configDir: host, id: ID, cwd })).toBe(join(projects, spelled, `${ID}.jsonl`));
    // Another session's file is never the answer.
    expect(hostTranscriptPath({ configDir: host, id: "11111111-2222-4333-8444-555555555555", cwd })).toBeNull();
  });

  test("the host's directory: CLAUDE_CONFIG_DIR when set, else ~/.claude (a temp home under test)", () => {
    expect(hostConfigDir({ CLAUDE_CONFIG_DIR: host })).toBe(host);
    expect(hostConfigDir({ CLAUDE_CONFIG_DIR: "  " }).endsWith(join("", ".claude"))).toBe(true);
  });

  test("absent, read and read short are said apart", () => {
    expect(readToolSpills(null).reason).toBe("absent");
    expect(readToolSpills(join(host, "nope.jsonl")).reason).toBe("absent");
    const path = join(host, "t.jsonl");
    writeFileSync(path, spilledNight(), "utf8");
    const whole = readToolSpills(path);
    expect(whole).toMatchObject({ reason: "read", results: 3, short: false });
    expect(whole.spills).toHaveLength(1);
    const short = readToolSpills(path, { maxBytes: 600 });
    expect(short.reason).toBe("read");
    expect(short.short).toBe(true);
    expect(short.corrupt).toBe(0);
  });

  test("the child is started with --session-id when the run names one, and without it otherwise (the catch-up child)", () => {
    const config: AdapterConfig = { dataDir: dir, owner: true };
    const base = { config, run: "nrn_1", prompt: "P", scope: "/proj", session: "s1", baseEnv: { PATH: "/usr/bin" } };
    const named = planNightChild({ ...base, hostSession: ID });
    const at = named.args.indexOf("--session-id");
    expect(at).toBeGreaterThan(-1);
    expect(named.args[at + 1]).toBe(ID);
    expect(planNightChild(base).args).not.toContain("--session-id");
  });
});

// ── 3. the run, end to end ──────────────────────────────────────────────────

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

function lived(c: Counterpart): void {
  c.store.advanceClock("2026-09-10");
  for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
  mem(c, "The migration step must run before the container boots, or it boots empty.");
  mem(c, "Run the migration before starting the container, otherwise the container starts empty.");
  mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" });
  mem(c, "I say what I do not know before I guess.", { kind: "self" });
}

const config = (): AdapterConfig => ({ dataDir: dir, owner: true, identity: { name: "Mike" } });

function openNight(): Counterpart {
  const c = openNightCounterpart(config());
  open.push(c);
  return c;
}

/** The run's child, injected: dreams and reflects through the store, and leaves `transcript` where the host would. */
function child(transcript: string | null, where: "spelled" | "elsewhere" = "elsewhere") {
  return async (plan: ChildPlan) => {
    const id = plan.args[plan.args.indexOf("--session-id") + 1] ?? "";
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    if (transcript !== null) {
      const name = where === "spelled" ? (plan.cwd ?? "").replace(/[^a-zA-Z0-9]/g, "-") : "-somewhere-else";
      mkdirSync(join(host, "projects", name), { recursive: true });
      writeFileSync(join(host, "projects", name, `${id}.jsonl`), transcript, "utf8");
    }
    dreamAndReflect();
    return { code: 0, timedOut: false, error: null };
  };
}

/** What a child that ran does to the store: a dream journaled, a reflection finished. */
function dreamAndReflect(): void {
  const c = openNightCounterpart(config());
  try {
    const d = c.dreams.begin({ session: "s1" });
    if (!d.ok) throw new Error(d.reason);
    c.dreams.journal({ dream: d.bundle.dream, session: "s1", title: "Boot order", text: "A dream." });
    const r = c.reflections.begin({ session: "s1", dream: d.bundle.dream });
    if (!r.ok) throw new Error(r.reason);
    c.reflections.finish({ reflection: r.bundle.reflection, session: "s1", entry: "Nothing much tonight." });
  } finally {
    c.close();
  }
}

function night(start: ReturnType<typeof child>): Parameters<typeof runNight>[0] {
  const cfg = config();
  return {
    open: () => openNightCounterpart(cfg),
    config: cfg,
    run: "nrn_spill",
    session: "s1",
    scope: dir,
    kind: { kind: "night" },
    date: "2026-09-20",
    baseEnv: { PATH: "/usr/bin:/bin" },
    hostConfigDir: host,
    start,
  };
}

function rows(c: Counterpart): Record<string, unknown>[] {
  return c.store.eventLog({ name: MCP_SPILLED_EVENT, limit: 100 }).map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
}

function input(over: Partial<HookInput> = {}): HookInput {
  const hook: HookInput = { sessionId: "s2", scope: "proj", turns: [], at: "2026-09-20", prompt: "good morning", ...over };
  recordSession(dir, { sessionId: hook.sessionId, scope: hook.scope, phase: "start" });
  return hook;
}

describe("the run reads its child's transcript once it exits", () => {
  test("a cut dream begin: one row, the count on the run's row, doctor amber, and the morning hand-back says it plainly", async () => {
    lived(openNight());
    const events: string[] = [];
    const out = await runNight({ ...night(child(spilledNight())), onEvent: (e) => events.push(e.name) });
    expect(out.state).toBe("done");
    expect(out).toMatchObject({ transcript: "read", spills: 1 });
    expect(events).toContain("adapter.night.spill");
    // Lane 0 (2026-10-10): the cut begin carried the night's fresh list, so
    // every new memory it named goes back in the queue, counted on the row.
    expect(out.requeued).toBe(4);
    const c = openNight();
    expect(nightRunOf(c.store)).toMatchObject({ requeued: 4 });
    const journaled = c.store.dreams({ limit: 1 })[0];
    expect(JSON.parse(journaled?.shown ?? "[]")).toEqual([]);
    expect(rows(c)).toEqual([{ run: "nrn_spill", tool: DREAM, phase: "begin", shape: "persisted", said: "51.5KB" }]);
    expect(nightRunOf(c.store)).toMatchObject({ state: "done", transcript: "read", spills: 1 });
    const done = c.store.eventLog({ name: "dream.night" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>).find((p) => p["state"] === "done");
    expect(done).toMatchObject({ transcript: "read", spills: 1 });
    // Doctor: amber, with the tool, the phase and the size.
    const [f] = resultFindings(c.store);
    expect(f?.severity).toBe("amber");
    expect(f?.detail).toContain("1 result of the nightly run reached the model only as Claude Code's short preview");
    expect(f?.detail).toContain("dream begin");
    expect(f?.detail).toContain("51.5KB");
    expect(f?.fix).toContain("lower than the 40000 characters");
    expect(f?.data["spilled"]).toBe(1);
    // The morning: the dream's line, then the cut, said plainly — once.
    c.close();
    const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    const turn = a.userPromptSubmit(input());
    expect(turn.injection).toContain("the nightly run finished in the background, on its own");
    expect(turn.injection).toContain("Claude Code cut one of the nightly run's tool results to a short preview");
    expect(turn.injection).toContain("The 4 new memories it could not see go back in the queue for the next dream.");
    expect(turn.injection).toContain("tell Mike plainly");
    expect(a.userPromptSubmit(input({ sessionId: "s3", prompt: "again" })).injection).not.toContain("Claude Code cut");
  });

  test("a clean night: no row, zero on the run's row, and doctor's green line says the transcript was read", async () => {
    lived(openNight());
    const clean = spilledNight().replace(JSON.stringify(persisted("51.5KB")), JSON.stringify('{"phase":"begin","dream":"drm_1"}'));
    const out = await runNight(night(child(clean, "spelled")));
    expect(out).toMatchObject({ state: "done", transcript: "read", spills: 0 });
    const c = openNight();
    expect(rows(c)).toEqual([]);
    // A part row so the line speaks at all (the dream was handed in parts).
    c.noteAdapterEvent(MCP_PART_EVENT, { mechanism: "dream", ref: "drm_x", part: 1, of: 1, chars: 30_000 });
    const [f] = resultFindings(c.store);
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain("the 2026-09-20 run's transcript showed none of our results cut by Claude Code");
    expect(f?.data["lastTranscript"]).toBe("read");
  });

  test("a transcript the host did not write where it keeps sessions: said as not checked, never as clean", async () => {
    lived(openNight());
    const out = await runNight(night(child(null)));
    expect(out.state).toBe("done");
    expect(out.transcript).toBe("absent");
    expect(out.spills).toBeUndefined();
    const c = openNight();
    expect(rows(c)).toEqual([]);
    c.noteAdapterEvent(MCP_PART_EVENT, { mechanism: "dream", ref: "drm_x", part: 1, of: 1, chars: 30_000 });
    const [f] = resultFindings(c.store);
    expect(f?.severity).toBe("green");
    expect(f?.detail).toContain("was not found where Claude Code keeps sessions, so Claude Code's cut was not checked");
  });

  test("REVIEW OF #330: doctor's advice follows the newest cut's shape — the token line and the turn's budget are not the character line", () => {
    const c = openNight();
    lived(c);
    c.noteAdapterEvent(MCP_SPILLED_EVENT, { run: "nrn_a", tool: DREAM, phase: "begin", shape: "tokens", said: "41,000 characters" });
    const [tok] = resultFindings(c.store);
    expect(tok?.severity).toBe("amber");
    expect(tok?.fix).toContain("token limit on one tool result came out lower than the 25000 tokens");
    expect(tok?.fix).not.toContain("40000 characters");
    c.noteAdapterEvent(MCP_SPILLED_EVENT, { run: "nrn_b", tool: DREAM, phase: "part", shape: "turn-budget", said: "39.8KB" });
    const [turn] = resultFindings(c.store);
    expect(turn?.fix).toContain("several results in one turn");
    expect(turn?.detail).toContain("2 results of the nightly run (2 runs)");
  });

  test("REVIEW OF #330: a host that refuses --session-id costs the night nothing — retried once without it, its cut unchecked", async () => {
    lived(openNight());
    const seen: string[][] = [];
    const events: { name: string; data: unknown }[] = [];
    const out = await runNight({
      ...night(child(null)),
      onEvent: (e) => events.push({ name: e.name, data: e.data }),
      start: async (plan: ChildPlan) => {
        seen.push([...plan.args]);
        // An old or changed host: an unknown option, refused before anything ran.
        if (plan.args.includes("--session-id")) return { code: 1, timedOut: false, error: null };
        dreamAndReflect();
        return { code: 0, timedOut: false, error: null };
      },
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("--session-id");
    expect(seen[1]).not.toContain("--session-id");
    expect(out).toMatchObject({ state: "done", transcript: "absent" });
    expect(out.spills).toBeUndefined();
    expect(events.find((e) => e.name === "adapter.night.spill")?.data).toMatchObject({ transcript: "absent", named: false });
  });

  test("REVIEW OF #330: a quick failure that left its transcript, or began something, is the night's own answer — never run twice", async () => {
    lived(openNight());
    let starts = 0;
    const leftTranscript = await runNight({
      ...night(child(null)),
      start: async (plan: ChildPlan) => {
        starts += 1;
        // Not logged in, say: the session was written, then the child gave up.
        const id = plan.args[plan.args.indexOf("--session-id") + 1] ?? "";
        mkdirSync(join(host, "projects", "-store"), { recursive: true });
        writeFileSync(join(host, "projects", "-store", `${id}.jsonl`), said("user", "the launch prompt"), "utf8");
        return { code: 1, timedOut: false, error: null };
      },
    });
    expect(starts).toBe(1);
    expect(leftTranscript).toMatchObject({ state: "could-not-start", reason: "quick-exit" });
    // No transcript, but a dream begun: not retried either.
    let again = 0;
    const began = await runNight({
      ...night(child(null)),
      run: "nrn_began",
      start: async () => {
        again += 1;
        const c = openNightCounterpart(config());
        try {
          c.dreams.begin({ session: "s1" });
        } finally {
          c.close();
        }
        return { code: 1, timedOut: false, error: null };
      },
    });
    expect(again).toBe(1);
    expect(began.state).not.toBe("done");
  });

  test("a child that never started has no transcript to read, and the row says nothing about one", async () => {
    const out = await runNight({ ...night(child(null)), start: async () => ({ code: null, timedOut: false, error: "Error", spawnCode: "ENOENT" }) });
    expect(out.state).toBe("could-not-start");
    expect(out.transcript).toBeUndefined();
  });
});

describe("the morning hand-back of a cut run", () => {
  test("said even when the run journaled nothing — the cut may be why; nothing is said when nothing was cut", () => {
    const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
    open.push(a.counterpart);
    lived(a.counterpart);
    const now = a.counterpart.store.now();
    const run: NightRun = { run: "nrn_cut", date: "2026-09-20", state: "failed", kind: "night", session: "s1", startedAt: now - 60_000, endedAt: now, reason: "exit", detail: null, code: 1, dream: null, reflection: null, transcript: "read", spills: 2 };
    a.counterpart.dreams.recordNightRun(run);
    const turn = a.userPromptSubmit(input());
    expect(turn.injection).toContain("Claude Code cut 2 of the nightly run's tool results to a short preview before the run could read them");
    expect(turn.injection).not.toContain("the nightly run finished in the background");
    expect(a.counterpart.dreams.nightSpillLine({ spills: 0 })).toBeNull();
    expect(a.counterpart.dreams.nightSpillLine({})).toBeNull();
  });
});

// ── 4. the reflection reads every part first ────────────────────────────────

describe("a reflection handed in parts is told to read every part before it writes", () => {
  test("the instructions open with it when the bundle comes in parts, and say nothing of parts when it is whole", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    open.push(c);
    lived(c);
    const whole = c.reflections.begin({ session: "s1" });
    if (!whole.ok) throw new Error(whole.reason);
    expect(whole.bundle.parts).toBeNull();
    expect(whole.instructions).not.toContain("read every part");
    expect(whole.instructions.startsWith("Reflect on the questions")).toBe(true);
    expect(c.reflections.launchPrompt({ session: "s1" })).toContain('fetch every part (phase "part") before you answer or write anything');
  });

  test("in parts: the first line names part 2 and the reflection, and the result still fits its room", () => {
    const c = Counterpart.open({ dir, owner: true, identity: { name: "Mike" } });
    open.push(c);
    lived(c);
    // Enough long memories that the bundle cannot come whole.
    for (let i = 0; i < 160; i += 1) mem(c, `A long memory ${String(i)} of a full week: ${"so much was said and done that day, at length. ".repeat(40)}`, { kind: i % 2 === 0 ? "self" : "person" });
    const out = c.reflections.begin({ session: "s1" });
    if (!out.ok) throw new Error(out.reason);
    const parts = out.bundle.parts;
    expect(parts).not.toBeNull();
    expect(parts?.of ?? 1).toBeGreaterThan(1);
    const first = out.instructions.split("\n")[0] ?? "";
    expect(first).toContain(`First, read every part: this bundle comes in ${String(parts?.of)} parts and this is part 1.`);
    expect(first).toContain(`phase "part", reflection: ${out.bundle.reflection}, session: s1, part: 2`);
    expect(first).toContain("reflect and write only once you have read them all");
    expect(parts?.next).toContain("Before you answer or write anything");
  });
});
