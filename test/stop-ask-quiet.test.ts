/**
 * THE STOP ASK — SHORTER, QUIETER, RARER (B1, owner's decisions of 2026-09-23;
 * new-user findings #28 and #13).
 *
 *   1. The person reads ONE short line; the model reads a TWO-line ask.
 *   2. Two emission shapes behind one switch (`claude-code.json#stopAskShape`),
 *      the JSON decision by default, stderr + exit 2 behind it. Both block.
 *   3. Pacing counts what the person typed: a subagent's hand-back, a task
 *      notification and hook feedback are not the owner speaking, and the
 *      transcript entry's own metadata says so.
 *   4. `session_end` with `memories: []` is an answer — "nothing new" —
 *      accepted, recorded, minting nothing, and never a cause of a re-ask.
 *
 * Plus I40: the scope registry's SessionStart warning reaches `systemMessage`.
 *
 * Hermetic: every test makes its own temp directory and removes it. The hook
 * processes run with a curated environment (temp HOME, no keys, no PATH), the
 * way `test/hook-standdown.test.ts` runs them.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_STOP_ASK_SHAPE,
  STOP_ASK_SHAPE_KEY,
  hostDelivery,
  joinNotices,
  stopAskShapeOf,
} from "../src/adapters/claude-code/bin/hook.js";
import { loadConfig } from "../src/adapters/claude-code/config.js";
import { STOP_HUMAN_LINE, stopAsk, substanceOf } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { STOP_ASK_OPENER, entryAuthor, parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { scopesPath } from "../src/adapters/scopes.js";
import { markNothingNew, readSession, recordSession } from "../src/adapters/sessions.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const UUID = "7c973b1c-d40a-47e5-92bb-8cdb1823a06d";

let work: string;
const closers: (() => void)[] = [];

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "counterparts-stop-ask-"));
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  rmSync(work, { recursive: true, force: true });
});

// ── the transcript shapes, as the host writes them ──────────────────────────
//
// Synthetic text in the host's real metadata shapes (Claude Code 2.1.28x,
// measured 2026-09-23 — `src/adapters/claude-code/NOTES.md` §"What the host
// writes user-role"). No line here is copied from a real transcript.

const TYPED = "Let's move the parser into its own module and keep the old entry point as a thin shim.";

const HANDBACK_TEXT = [
  "Another Claude session sent a message:",
  '<agent-message from="a0000000000000001">',
  "[Subagent hand-back] The text below is the final report of a subagent this session delegated to.",
  "Built the parser module and added twelve tests; the suite is green.",
  "</agent-message>",
].join("\n");

const NOTIFICATION_TEXT = [
  "<task-notification>",
  "<task-id>b0000fixture</task-id>",
  "<status>completed</status>",
  '<summary>Background command "Run the suite" completed (exit code 0)</summary>',
  "</task-notification>",
].join("\n");

const FEEDBACK_TEXT = `Stop hook feedback:\n["/usr/local/bin/bun" run "/opt/counterparts/src/adapters/claude-code/bin/hook.ts"]: ${stopAsk("s-fixture", 1)}`;

const typedEntry = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  origin: { kind: "human" },
  promptSource: "typed",
  turnOrigin: "human",
  message: { role: "user", content: text },
});
const handbackEntry = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  isMeta: true,
  origin: {
    kind: "peer",
    from: "a0000000000000001",
    senderTaskId: "a0000000000000001",
    body: "[Subagent hand-back] The text below is the final report of a subagent this session delegated to.",
  },
  promptSource: "system",
  turnOrigin: "peer",
  message: { role: "user", content: text },
});
const notificationEntry = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  origin: { kind: "task-notification" },
  promptSource: "system",
  turnOrigin: "task_notification",
  message: { role: "user", content: text },
});
const metaEntry = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  isMeta: true,
  message: { role: "user", content: text },
});
const bareEntry = (text: string): Record<string, unknown> => ({
  type: "user",
  message: { role: "user", content: text },
});
const assistantEntry = (text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "assistant",
  message: { role: "assistant", model: "claude-test", content: [{ type: "text", text }] },
  ...extra,
});

const jsonl = (entries: readonly Record<string, unknown>[]): string =>
  entries.map((e) => JSON.stringify(e)).join("\n");

describe("pacing counts only what the person typed (decision 3)", () => {
  test("ACCEPTANCE: 1 typed turn + a hand-back + a task notification + hook feedback paces as ONE turn, typed bytes only", () => {
    const read = parseTranscript(
      jsonl([
        typedEntry(TYPED),
        handbackEntry(HANDBACK_TEXT),
        notificationEntry(NOTIFICATION_TEXT),
        metaEntry(FEEDBACK_TEXT),
      ]),
    );
    // One turn per text block, exactly as before — the per-session cursor
    // indexes into this list, so reclassifying may never add or drop a turn.
    expect(read.turns.length).toBe(4);
    expect(read.turns.map((t) => t.source)).toEqual(["conversation", "injected", "injected", "ritual"]);
    expect(substanceOf(read.turns)).toEqual({ turns: 1, bytes: Buffer.byteLength(TYPED, "utf8") });
  });

  test("the SAME four texts with NO metadata (an older build) still pace as one — the text markers are the fallback", () => {
    const read = parseTranscript(
      jsonl([bareEntry(TYPED), bareEntry(HANDBACK_TEXT), bareEntry(NOTIFICATION_TEXT), bareEntry(FEEDBACK_TEXT)]),
    );
    expect(read.turns.map((t) => t.source)).toEqual(["conversation", "injected", "injected", "ritual"]);
    expect(substanceOf(read.turns)).toEqual({ turns: 1, bytes: Buffer.byteLength(TYPED, "utf8") });
  });

  test("hook feedback on an isMeta entry stays RITUAL — refused from capture, not merely unpaced (G11)", () => {
    // The order is the rule: were the metadata step first, this block would be
    // `injected`, which `enters()` KEEPS — our own ask encoded as experience.
    const [turn] = parseTranscript(jsonl([metaEntry(FEEDBACK_TEXT)])).turns;
    expect(turn?.source).toBe("ritual");
  });

  test("our own ask written by the host WITHOUT the feedback prefix is still ritual; the person quoting it is not", () => {
    const ask = stopAsk("s1", 2);
    expect(ask.startsWith(STOP_ASK_OPENER)).toBe(true);
    expect(parseTranscript(jsonl([metaEntry(ask)])).turns[0]?.source).toBe("ritual");
    expect(parseTranscript(jsonl([typedEntry(ask)])).turns[0]?.source).toBe("conversation");
  });

  test("a v1 marker is still FOREIGN on an isMeta entry — the refusals come before the metadata", () => {
    const theirs = "Stop hook feedback:\n- [bansai] Before this session closes, what did you learn?";
    expect(parseTranscript(jsonl([metaEntry(theirs)])).turns[0]?.source).toBe("foreign");
  });

  test("what the person PASTED is the person: typed metadata wins over a text marker inside it", () => {
    const pasted = "Here is the log I saw:\n<system-reminder>not really a reminder, just text I pasted</system-reminder>";
    expect(parseTranscript(jsonl([typedEntry(pasted)])).turns[0]?.source).toBe("conversation");
    // With no metadata the marker still decides, exactly as before.
    expect(parseTranscript(jsonl([bareEntry(pasted)])).turns[0]?.source).toBe("injected");
  });

  test("the peer rule predates the metadata and holds under it: a block that is ONLY a peer wrapper is never the person", () => {
    const peer = '<cross-session-message from-name="builder">The suite is green.</cross-session-message>';
    const [only] = parseTranscript(jsonl([typedEntry(peer)])).turns;
    expect(only?.source).toBe("injected");
    expect(only?.text).toBe("[message from another Claude session, builder]: The suite is green.");
    const [mixed] = parseTranscript(jsonl([typedEntry(`Look at this: ${peer}`)])).turns;
    expect(mixed?.source).toBe("conversation");
  });

  test("every other host-written user line is injected: compaction summary, /context output, image captions, idle notice", () => {
    const read = parseTranscript(
      jsonl([
        { ...bareEntry("This session is being continued from a previous conversation that ran out of context."), isCompactSummary: true },
        metaEntry("## Context Usage\n\n**Model:** test"),
        { ...metaEntry("[Image: original 800x600, displayed at 800x600]"), turnCompanion: true },
        { ...metaEntry('[Cross-session idle notice] "builder" is idle now'), promptSource: "system" },
        bareEntry("[Request interrupted by user]"),
        bareEntry("UserPromptSubmit hook success: Success"),
        bareEntry("<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>"),
      ]),
    );
    expect(read.turns.map((t) => t.source)).toEqual(Array.from({ length: 7 }, () => "injected"));
    expect(substanceOf(read.turns)).toEqual({ turns: 0, bytes: 0 });
  });

  test("hook output the host records as an ATTACHMENT carries no role and is never a turn", () => {
    const read = parseTranscript(
      jsonl([
        {
          type: "attachment",
          attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", content: "recall block", stdout: "recall block" },
        },
        typedEntry(TYPED),
      ]),
    );
    expect(read.turns.length).toBe(1);
    expect(read.turns[0]?.source).toBe("conversation");
  });

  test("the assistant's own replies still pace, as they always have; an API error the HOST wrote does not", () => {
    // Thresholds are unchanged this round (roadmap B1 §5): the pacer has
    // always counted the assistant's conversational text, so this fix stays on
    // the user side, where the misreading was.
    const reply = "Done — the parser is in its own module now.";
    const read = parseTranscript(
      jsonl([
        typedEntry(TYPED),
        assistantEntry(reply),
        assistantEntry("API Error: Rate limit reached", { isApiErrorMessage: true }),
        { type: "assistant", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } },
      ]),
    );
    expect(read.turns.map((t) => t.source)).toEqual(["conversation", "conversation", "injected", "injected"]);
    expect(substanceOf(read.turns)).toEqual({
      turns: 2,
      bytes: Buffer.byteLength(TYPED, "utf8") + Buffer.byteLength(reply, "utf8"),
    });
  });

  test("entryAuthor reads the host's own fields and nothing else", () => {
    expect(entryAuthor(typedEntry("x"), "user")).toBe("human");
    expect(entryAuthor({ ...typedEntry("x"), promptSource: "queued" }, "user")).toBe("human");
    expect(entryAuthor(handbackEntry("x"), "user")).toBe("host");
    expect(entryAuthor(notificationEntry("x"), "user")).toBe("host");
    expect(entryAuthor(metaEntry("x"), "user")).toBe("host");
    expect(entryAuthor({ ...bareEntry("x"), origin: { kind: "some-future-kind" } }, "user")).toBe("host");
    expect(entryAuthor(bareEntry("x"), "user")).toBe("unknown");
    expect(entryAuthor({ ...bareEntry("x"), origin: "human" }, "user")).toBe("unknown");
    expect(entryAuthor(assistantEntry("x"), "assistant")).toBe("unknown");
  });
});

// ── the text, pinned ─────────────────────────────────────────────────────────

describe("the person reads one line, the model reads two (decision 1)", () => {
  test("PINNED: the model's ask, word for word — it may not grow without this test changing", () => {
    expect(stopAsk("SID", 3)).toBe(
      "Counterparts, before this session closes: 1) hand back what you learned here that is worth keeping with the counterparts session_end tool, session: SID — set `handoff` on it only if work here is unfinished.\n" +
        "2) Write chapter 3 of this session's episode with the counterparts chapter tool, session: SID. Nothing worth keeping is a real answer: send `memories: []`.",
    );
  });

  test("PINNED: the person's line, word for word", () => {
    expect(STOP_HUMAN_LINE).toBe("Counterparts: asking the assistant to write up this session's memories.");
    expect(STOP_HUMAN_LINE).not.toContain("\n");
    expect(STOP_HUMAN_LINE.length).toBeLessThanOrEqual(100);
  });

  test("two lines, two numbered items, the id on both, both tools, both clauses", () => {
    const text = stopAsk(UUID, 1);
    const lines = text.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]?.startsWith(STOP_ASK_OPENER)).toBe(true);
    expect(lines[0]).toContain("1) ");
    expect(lines[1]?.startsWith("2) ")).toBe(true);
    expect(text.split(UUID).length - 1).toBe(2);
    expect(lines[0]).toContain("session_end tool");
    expect(lines[1]).toContain("chapter tool");
    // The two clauses about WHETHER to write, and nothing about HOW: the field
    // detail lives in the tools' own descriptions.
    expect(text).toContain("set `handoff` on it only if work here is unfinished");
    expect(text).toContain("Nothing worth keeping is a real answer");
    expect(text).not.toContain("salience");
    expect(text).not.toContain("updates");
    // Less than a third of the nine-line text it replaces (~1,250 characters
    // with a real id).
    expect(text.length).toBeLessThanOrEqual(450);
  });

  test("the chapter number is the store's, on every chapter including the first", () => {
    expect(stopAsk("s1", 1)).toContain("Write chapter 1 of");
    expect(stopAsk("s1", 4)).toContain("Write chapter 4 of");
  });

  test("the field detail the ask dropped is carried by the tool descriptions instead", async () => {
    const { toolSpec } = await import("../src/adapters/mcp/index.js");
    const spec = toolSpec("session_end");
    const described = JSON.stringify(spec);
    expect(described).toContain("`updates` is a FIELD");
    expect(described).toContain("A salience you claim is a floor");
    expect(described).toContain("your claim is the only way what you lived outranks what a sweep noticed");
    expect(described).toContain("`handoff` is a FIELD on this call and NEVER a memory");
    expect(described).toContain("An EMPTY `memories` array is a real answer");
    expect(JSON.stringify(toolSpec("chapter"))).toContain("a short true chapter beats a deep-sounding one");
  });
});

// ── the two shapes ───────────────────────────────────────────────────────────

describe("the two emission shapes, both blocking (decision 2)", () => {
  const ask = stopAsk(UUID, 2);
  const R = { injection: null, ask };

  test("the default is the JSON decision", () => {
    expect(DEFAULT_STOP_ASK_SHAPE).toBe("json");
    expect(STOP_ASK_SHAPE_KEY).toBe("stopAskShape");
  });

  test("JSON: one well-formed object, exactly three keys, exit 0 — the decision is what blocks", () => {
    const d = hostDelivery("stop", R, {});
    expect(d.exitCode).toBe(0);
    expect(d.stderr).toBe("");
    expect(d.dropped).toBeNull();
    // The WHOLE of stdout is the object, or the host reads it as plain text.
    expect(d.stdout.trim()).toBe(d.stdout);
    expect(d.stdout.startsWith("{") && d.stdout.endsWith("}")).toBe(true);
    const parsed = JSON.parse(d.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["decision", "reason", "systemMessage"]);
    expect(parsed).toEqual({ decision: "block", reason: ask, systemMessage: STOP_HUMAN_LINE });
    // Explicitly asking for it is the same thing.
    expect(hostDelivery("stop", R, {}, null, "json")).toEqual(d);
  });

  test("stderr: the model's two lines on stderr, exit 2, nothing on stdout", () => {
    expect(hostDelivery("stop", R, {}, null, "stderr")).toEqual({
      stdout: "",
      stderr: ask,
      exitCode: 2,
      dropped: null,
    });
  });

  test("BOTH shapes refuse the host's re-fire and stay silent with nothing to ask", () => {
    for (const shape of ["json", "stderr"] as const) {
      expect(hostDelivery("stop", R, { stop_hook_active: true }, null, shape)).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
        dropped: null,
      });
      expect(hostDelivery("stop", { injection: null, ask: null }, {}, null, shape)).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
        dropped: null,
      });
    }
  });

  test("the switch affects the Stop ONLY", () => {
    const wake = { injection: "the wake", ask: null };
    expect(hostDelivery("session-start", wake, {}, null, "stderr")).toEqual(hostDelivery("session-start", wake, {}));
    expect(hostDelivery("user-prompt-submit", wake, {}, null, "stderr").exitCode).toBe(0);
  });

  test("the switch is read leniently: only the exact string picks stderr, and it never makes a config unreadable", () => {
    expect(stopAskShapeOf({ stopAskShape: "stderr" })).toBe("stderr");
    for (const raw of [undefined, null, [], "stderr", {}, { stopAskShape: "json" }, { stopAskShape: "STDERR" }, { stopAskShape: 2 }]) {
      expect(stopAskShapeOf(raw)).toBe("json");
    }
    // A display preference must not stand the adapter down to observer.
    const loaded = loadConfig({ dataDir: join(work, "store"), stopAskShape: "stderr" });
    expect(loaded.ok).toBe(true);
    expect(loaded.config.observer).toBeUndefined();
    const typo = loadConfig({ dataDir: join(work, "store"), stopAskShape: 42 });
    expect(typo.ok).toBe(true);
  });
});

// ── the real process ─────────────────────────────────────────────────────────

interface HookRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function hookEnv(): Record<string, string> {
  const home = join(work, "home");
  const bin = join(work, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  return { PATH: bin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}

function writeConfig(extra: Record<string, unknown> = {}): string {
  const path = join(work, "claude-code.json");
  writeFileSync(path, JSON.stringify({ dataDir: join(work, "store"), injectionBudgetBytes: 9000, ...extra }), "utf8");
  return path;
}

function runHook(configPath: string, payload: Record<string, unknown>): HookRun {
  const project = join(work, "project");
  mkdirSync(project, { recursive: true });
  const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath], {
    input: JSON.stringify({ cwd: project, ...payload }),
    encoding: "utf8",
    env: hookEnv(),
    timeout: 60_000,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Twelve real turns and ~7 KB: past `FIRST_ASK_TURNS` and `FIRST_ASK_BYTES`. */
function writeTranscript(): string {
  const path = join(work, "transcript.jsonl");
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < 6; i += 1) {
    entries.push(typedEntry(`Question ${String(i)}: ${"a real question about the parser, asked at working length. ".repeat(10)}`));
    entries.push(assistantEntry(`Answer ${String(i)}: ${"a real answer about the parser, given at working length. ".repeat(10)}`));
  }
  writeFileSync(path, `${jsonl(entries)}\n`, "utf8");
  return path;
}

describe("the switch, end to end through the hook process", () => {
  test("default config: a due Stop prints the JSON decision and exits 0; the re-fire prints nothing", () => {
    const config = writeConfig();
    const transcript = writeTranscript();
    runHook(config, { hook_event_name: "SessionStart", session_id: "s-json", source: "startup", transcript_path: transcript });
    const stop = runHook(config, { hook_event_name: "Stop", session_id: "s-json", transcript_path: transcript });
    expect(stop.code).toBe(0);
    const parsed = JSON.parse(stop.stdout) as Record<string, unknown>;
    expect(parsed["decision"]).toBe("block");
    expect(parsed["reason"]).toBe(stopAsk("s-json", 1));
    expect(parsed["systemMessage"]).toBe(STOP_HUMAN_LINE);
    expect(stop.stderr).not.toContain(STOP_ASK_OPENER);
    const refire = runHook(config, {
      hook_event_name: "Stop",
      session_id: "s-json",
      transcript_path: transcript,
      stop_hook_active: true,
    });
    expect({ code: refire.code, stdout: refire.stdout }).toEqual({ code: 0, stdout: "" });
  });

  test(`"${STOP_ASK_SHAPE_KEY}": "stderr" — the same Stop exits 2 with the ask on stderr and nothing on stdout`, () => {
    const config = writeConfig({ [STOP_ASK_SHAPE_KEY]: "stderr" });
    const transcript = writeTranscript();
    runHook(config, { hook_event_name: "SessionStart", session_id: "s-stderr", source: "startup", transcript_path: transcript });
    const stop = runHook(config, { hook_event_name: "Stop", session_id: "s-stderr", transcript_path: transcript });
    expect(stop.code).toBe(2);
    expect(stop.stdout).toBe("");
    expect(stop.stderr).toBe(stopAsk("s-stderr", 1));
  });
});

// ── I40 ──────────────────────────────────────────────────────────────────────

describe("I40 — the scope registry's warning reaches the person", () => {
  test("a registry that cannot be read is said in the SessionStart systemMessage, and the wake still arrives", () => {
    const config = writeConfig();
    writeFileSync(scopesPath(config), "{ broken", "utf8");
    const run = runHook(config, { hook_event_name: "SessionStart", session_id: "s-i40", source: "startup" });
    expect(run.code).toBe(0);
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    const message = String(parsed["systemMessage"]);
    expect(message).toContain("[counterparts] scope registry");
    expect(message).toContain(scopesPath(config));
    expect(message).toContain("reads as unset (on)");
    const out = parsed["hookSpecificOutput"] as Record<string, unknown>;
    expect(out["hookEventName"]).toBe("SessionStart");
    expect(String(out["additionalContext"])).toContain("has not lived a boundary");
  });

  test("a healthy registry says nothing, and the wake stays plain text", () => {
    const config = writeConfig();
    const run = runHook(config, { hook_event_name: "SessionStart", session_id: "s-i40-ok", source: "startup" });
    expect(run.code).toBe(0);
    expect(run.stdout.startsWith("{")).toBe(false);
  });

  test("joinNotices: the registry line first, then the doctor notice; null when neither speaks", () => {
    expect(joinNotices(null, null)).toBeNull();
    expect(joinNotices("", null)).toBeNull();
    expect(joinNotices("registry", null)).toBe("registry");
    expect(joinNotices(null, "doctor")).toBe("doctor");
    expect(joinNotices("registry", "doctor")).toBe("registry\ndoctor");
  });
});

// ── nothing new ──────────────────────────────────────────────────────────────

describe("'nothing new' is an answer (decision 4)", () => {
  const SESSION = "s-nothing-new";
  let store: string;
  let project: string;

  beforeEach(() => {
    store = join(work, "store");
    project = join(work, "project");
    mkdirSync(project, { recursive: true });
  });

  function adapter(): ClaudeCodeAdapter {
    const a = openAdapter(
      { dataDir: store, injectionBudgetBytes: 9000, owner: true },
      { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) },
    );
    closers.push(() => a.counterpart.close());
    return a;
  }

  function server(): McpServer {
    const s = openServer({ dir: store, scope: project, owner: true });
    closers.push(() => s.counterpart.close());
    return s;
  }

  const BIG: HookInput["turns"] = Array.from({ length: 14 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    text: `Turn ${String(i)}: ${"a real exchange with enough substance in it to pace a ritual honestly. ".repeat(5)}`,
  }));

  function stopInput(turns: HookInput["turns"]): HookInput {
    return { sessionId: SESSION, scope: project, turns, at: "2026-09-23" };
  }

  test("ACCEPTANCE: `memories: []` is accepted, recorded, mints nothing — and the next Stop does not re-ask", async () => {
    const a = adapter();
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    expect(a.stop(stopInput(BIG)).ask).toBe(stopAsk(SESSION, 1));

    const s = server();
    const before = s.counterpart.store.list({ type: "memory" }).length;
    const result = await s.call("session_end", { session: SESSION, memories: [] });
    expect(result.isError).toBeUndefined();
    const out = (result.structuredContent ?? {}) as Record<string, unknown>;
    expect(out["reason"]).toBe("nothing-new");
    expect(out["entries"]).toBe(0);
    expect(out["deposited"]).toBe(0);
    expect(out["handoff"]).toBeUndefined();
    expect(s.counterpart.store.list({ type: "memory" }).length).toBe(before);
    const mark = readSession(store, SESSION)?.nothingNewAt;
    expect(typeof mark).toBe("number");

    // The model's one-line reply to the ask, and the host's next Stop. The
    // pacer advanced when the ask went out, so an answer — this one included —
    // cannot open the next ask; only eight more turns AND 8 KB can.
    const again = a.stop(stopInput([...(BIG ?? []), { role: "assistant", text: "Nothing new worth keeping from this stretch." }]));
    expect(again.ask).toBeNull();
    const outcomes = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 10 })
      .map((r) => (JSON.parse(r.payload ?? "{}") as Record<string, unknown>)["outcome"]);
    expect(outcomes).toEqual(["asked", "paced"]);
    // And the hook's own rewrite of the record at that Stop carried the mark.
    expect(readSession(store, SESSION)?.nothingNewAt).toBe(mark);
  });

  test("a call that LEAVES OUT `memories` has answered nothing, and is still refused", async () => {
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    const s = server();
    const result = await s.call("session_end", { session: SESSION });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>)["reason"]).toBe("memories-required");
    expect(readSession(store, SESSION)?.nothingNewAt).toBeUndefined();
  });

  test("a handoff with an empty list is still handoff-only, and it too is recorded as answered", async () => {
    recordSession(store, { sessionId: SESSION, scope: project, phase: "start" });
    const s = server();
    const result = await s.call("session_end", {
      session: SESSION,
      memories: [],
      handoff: "Placeholder: the parser move is half done; the shim is next.",
    });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as Record<string, unknown>)["reason"]).toBe("handoff-only");
    expect(typeof readSession(store, SESSION)?.nothingNewAt).toBe("number");
  });

  test("the mark moves no clock and creates no record", () => {
    const started = recordSession(store, { sessionId: SESSION, scope: project, phase: "start", at: 1_000 });
    const marked = markNothingNew(store, SESSION, 5_000);
    expect(marked?.nothingNewAt).toBe(5_000);
    expect(marked?.lastBoundaryAt).toBe(started?.lastBoundaryAt);
    expect(marked?.startedAt).toBe(started?.startedAt);
    expect(markNothingNew(store, "never-recorded", 5_000)).toBeNull();
    expect(readSession(store, "never-recorded")).toBeNull();
    expect(markNothingNew(store, "../escape", 5_000)).toBeNull();
    // A later phase carries it; a newer mark replaces it.
    recordSession(store, { sessionId: SESSION, scope: project, phase: "boundary", at: 6_000 });
    expect(readSession(store, SESSION)?.nothingNewAt).toBe(5_000);
    expect(markNothingNew(store, SESSION, 7_000)?.nothingNewAt).toBe(7_000);
  });
});
