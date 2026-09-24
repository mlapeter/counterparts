/**
 * THE STOP ASK — SHORTER, QUIETER, RARER (B1, owner's decisions of 2026-09-23;
 * new-user findings #28 and #13).
 *
 *   1. The person reads ONE short line; the model reads a TWO-line ask.
 *   2. ONE emission shape since 2026-09-24 (the owner looked at B1's two and
 *      both read as an error): `hookSpecificOutput.additionalContext` on Stop,
 *      the host's documented non-error route, with the person's line as
 *      `systemMessage`. The old `stopAskShape` switch is read and ignored.
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

import { ENVELOPE_MAX_CHARS, HOST_STOP, hostDelivery, toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { loadConfig } from "../src/adapters/claude-code/config.js";
import { STOP_HUMAN_LINE, stopAsk, substanceOf } from "../src/adapters/claude-code/hooks.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { STOP_ASK_OPENER, entryAuthor, parseTranscript } from "../src/adapters/claude-code/transcript.js";
import { openServer, renderDescription, toolSpec } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { describeScopeTrouble, readScopes, scopesPath } from "../src/adapters/scopes.js";
import { markNothingNew, readSession, recordSession } from "../src/adapters/sessions.js";
import { SELF_TUNABLES } from "../src/core/self/tunables.js";

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

  test("the JSON shape's return frame is UNMEASURED, so any hook frame in front of our ask is still ritual", () => {
    // The docs call a blocking decision a "hook error"; `Stop hook error` is
    // also a HOST_FRAMES opener, which on its own would make the block
    // `injected` — kept in capture. The own-ask check runs first.
    const ask = stopAsk("s1", 1);
    for (const framed of [
      `Stop hook error: ${ask}`,
      `Stop hook error:\n["/usr/local/bin/bun" run "/opt/counterparts/src/adapters/claude-code/bin/hook.ts"]: ${ask}`,
      `Stop hook blocking error:\n- ${ask}`,
    ]) {
      expect(parseTranscript(jsonl([metaEntry(framed)])).turns[0]?.source).toBe("ritual");
    }
    // A hand-back that merely QUOTES the ask is a hand-back.
    const quoting = `${HANDBACK_TEXT}\nThe ask read: ${ask}`;
    expect(parseTranscript(jsonl([handbackEntry(quoting)])).turns[0]?.source).toBe("injected");
  });

  test("the additionalContext route (2026-09-24): the host files it as an ATTACHMENT, which is never a turn", () => {
    // The shape read off the host's 2.1.281 bundle: `hook_additional_context`,
    // `hookName`/`hookEvent` "Stop", the ask in a `content` list.
    const ask = stopAsk("s1", 1);
    const read = parseTranscript(
      jsonl([
        typedEntry(TYPED),
        {
          type: "attachment",
          attachment: { type: "hook_additional_context", content: [ask], hookName: "Stop", toolUseID: "t1", hookEvent: "Stop" },
        },
      ]),
    );
    expect(read.turns.map((t) => t.source)).toEqual(["conversation"]);
    expect(read.turns.some((t) => t.text.includes(STOP_ASK_OPENER))).toBe(false);
  });

  test("…and the frame the MODEL reads it in is ritual too, should a build ever write it as user text", () => {
    const ask = stopAsk("s1", 1);
    const shapes = [
      `Stop hook additional context: ${ask}`,
      `<system-reminder>\nStop hook additional context: ${ask}\n</system-reminder>`,
      `<system-reminder>${ask}</system-reminder>`,
      `Stop hook feedback: ${ask}`,
    ];
    for (const framed of shapes) {
      // Host-written (isMeta) and with no metadata at all: our own ask, framed.
      expect(`${framed} -> ${String(parseTranscript(jsonl([metaEntry(framed)])).turns[0]?.source)}`).toBe(`${framed} -> ritual`);
      expect(`${framed} -> ${String(parseTranscript(jsonl([bareEntry(framed)])).turns[0]?.source)}`).toBe(`${framed} -> ritual`);
    }
    // What the person TYPED is the person, whatever it looks like.
    expect(parseTranscript(jsonl([typedEntry(shapes[0] ?? "")])).turns[0]?.source).toBe("conversation");
    // Some OTHER hook's additional context is still injected, not ours.
    const other = "<system-reminder>\nPostToolUse hook additional context: run the linter\n</system-reminder>";
    expect(parseTranscript(jsonl([metaEntry(other)])).turns[0]?.source).toBe("injected");
    expect(parseTranscript(jsonl([bareEntry(other)])).turns[0]?.source).toBe("injected");
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

  test("review m1: with NO metadata the person may be speaking — the new markers never refuse or unpace their words", () => {
    const rows: [Record<string, unknown>, string][] = [
      // Quoting the ask's opener: the own-ask rule is for HOST-written entries only.
      [bareEntry("Counterparts, before this session closes: 1) what does this mean?"), "conversation"],
      // A headless prompt about the person's own broken hook.
      [{ ...bareEntry("PreToolUse hook error: my linter blocks every edit, can you see why?"), promptSource: "sdk" }, "conversation"],
      // Mentioning a wrapper mid-sentence: the new tags are anchored.
      [bareEntry("Why does the hand-back arrive as an <agent-message> wrapper?"), "conversation"],
      [bareEntry("What is a <task-notification> and who writes it?"), "conversation"],
    ];
    for (const [entry, want] of rows) {
      const text = String((entry["message"] as Record<string, unknown>)["content"]);
      expect(`${text} -> ${String(parseTranscript(jsonl([entry])).turns[0]?.source)}`).toBe(`${text} -> ${want}`);
    }
  });

  test("review m2: the assistant's own text is never reclassified by a marker — it stays conversation (bytes, never turns)", () => {
    const texts = [
      "The host wraps it in `<task-notification>` and the reader now tags it.",
      "Its output arrives as `<bash-stdout>`, which is why it is excluded.",
      "Stop hook error is what the terminal prints for exit 2.",
      `${STOP_ASK_OPENER} is how the ask opens, so the reader can recognise it.`,
      "<agent-message> is the wrapper a hand-back uses.",
    ];
    const read = parseTranscript(jsonl(texts.map((t) => assistantEntry(t))));
    expect(read.turns.map((t) => t.source)).toEqual(texts.map(() => "conversation"));
    expect(substanceOf(read.turns)).toEqual({
      turns: 0,
      bytes: texts.reduce((n, t) => n + Buffer.byteLength(t, "utf8"), 0),
    });
  });

  test("review m5: a line that is literally `null` (or any non-object JSON) is counted and skipped, never thrown on", () => {
    const raw = ["null", "42", "[1,2]", '"text"', JSON.stringify(typedEntry(TYPED))].join("\n");
    let read: ReturnType<typeof parseTranscript> | undefined;
    expect(() => {
      read = parseTranscript(raw);
    }).not.toThrow();
    expect(read?.turns.length).toBe(1);
    expect(read?.corrupt).toBe(4);
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

  test("the assistant's own replies add bytes but never turns; an API error the HOST wrote adds neither", () => {
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
      turns: 1,
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

// ── the pace: typed turns, or text from both roles (2026-09-24) ─────────────

describe("the pace is what the person typed; conversation text from both roles is the other door", () => {
  const T = SELF_TUNABLES;
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

  /** A Stop on a transcript, the way the hook reads it. */
  function stopOn(a: ClaudeCodeAdapter, session: string, entries: readonly Record<string, unknown>[]): string | null {
    recordSession(store, { sessionId: session, scope: project, phase: "start" });
    const read = parseTranscript(jsonl(entries));
    return a.stop({ sessionId: session, scope: project, turns: read.turns, at: "2026-09-24" }).ask;
  }

  const toolCall = (i: number): Record<string, unknown>[] => [
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `t${String(i)}`, name: "Bash", input: {} }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${String(i)}`, content: "ok" }] } },
  ];

  /**
   * The measured shape: a few typed messages, and after each the assistant
   * writing in separate text blocks between tool calls. `assistantBytes` is
   * spread evenly over `blocks` blocks.
   */
  function session(typed: number, blocks: number, assistantBytes: number): Record<string, unknown>[] {
    const per = Math.ceil(assistantBytes / blocks);
    const entries: Record<string, unknown>[] = [];
    let block = 0;
    for (let m = 0; m < typed; m += 1) {
      entries.push(typedEntry(`Message ${String(m)}: let's keep going on the parser.`));
      const here = m === typed - 1 ? blocks - block : Math.floor(blocks / typed);
      for (let b = 0; b < here; b += 1, block += 1) {
        entries.push(assistantEntry(`Block ${String(block)}: ${"w".repeat(per)}`));
        entries.push(...toolCall(block));
      }
    }
    return entries;
  }

  const bytesOf = (entries: readonly Record<string, unknown>[]): number => substanceOf(parseTranscript(jsonl(entries)).turns).bytes;

  test("ACCEPTANCE: 2 typed messages + 10 assistant blocks of ~9 KB is NOT an ask; the same writing with enough typed messages is", () => {
    const quiet = session(2, 10, 9_000);
    const read = parseTranscript(jsonl(quiet));
    expect(substanceOf(read.turns).turns).toBe(2);
    // The fixture's premise, from the tunables: under both first-ask doors.
    expect(2).toBeLessThan(T.FIRST_ASK_TURNS);
    expect(bytesOf(quiet)).toBeLessThan(T.FIRST_ASK_TEXT_BYTES);
    const a = adapter();
    expect(stopOn(a, "s-two", quiet)).toBeNull();

    const busy = session(T.FIRST_ASK_TURNS, 10, 9_000);
    expect(bytesOf(busy)).toBeLessThan(T.FIRST_ASK_TEXT_BYTES);
    expect(stopOn(a, "s-six", busy)).toBe(stopAsk("s-six", 1));
  });

  test("ACCEPTANCE: combined text past the threshold asks with only 2 typed messages (the coordinator's day)", () => {
    const long = session(2, 10, T.FIRST_ASK_TEXT_BYTES);
    expect(bytesOf(long)).toBeGreaterThanOrEqual(T.FIRST_ASK_TEXT_BYTES);
    expect(stopOn(adapter(), "s-long", long)).toBe(stopAsk("s-long", 1));
  });

  test("one typed message is one turn, however many text blocks it holds", () => {
    const entry = {
      ...typedEntry(""),
      message: {
        role: "user",
        content: [
          { type: "text", text: "Here is the screenshot" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "text", text: "and the log below it." },
        ],
      },
    };
    const read = parseTranscript(jsonl([entry, typedEntry(TYPED)]));
    // Two blocks from the first entry stay two turns for the cursor...
    expect(read.turns.length).toBe(3);
    // ...and pace as ONE message.
    expect(substanceOf(read.turns).turns).toBe(2);
  });

  test("hand-backs, notifications and our own ask never count as turns, however many arrive", () => {
    const entries: Record<string, unknown>[] = [typedEntry(TYPED)];
    for (let i = 0; i < T.FIRST_ASK_TURNS * 2; i += 1) {
      entries.push(handbackEntry(HANDBACK_TEXT), notificationEntry(NOTIFICATION_TEXT), metaEntry(FEEDBACK_TEXT));
    }
    expect(substanceOf(parseTranscript(jsonl(entries)).turns)).toEqual({ turns: 1, bytes: Buffer.byteLength(TYPED, "utf8") });
    expect(stopOn(adapter(), "s-handbacks", entries)).toBeNull();
  });

  test("every ask row says what its `turns` counts", () => {
    const a = adapter();
    stopOn(a, "s-stamp", session(1, 1, 100));
    const row = a.counterpart.store.eventLog({ name: "adapter.ask", limit: 5 }).at(-1);
    expect((JSON.parse(row?.payload ?? "{}") as Record<string, unknown>)["counting"]).toBe("typed");
  });

  test("an unreadable transcript at one Stop moves no watermark, and the next Stop is not due", () => {
    const a = adapter();
    const id = "s-unread";
    recordSession(store, { sessionId: id, scope: project, phase: "start" });
    const path = join(work, "unread.jsonl");
    const start = session(T.FIRST_ASK_TURNS, 2, 400);
    writeFileSync(path, `${jsonl(start)}\n`, "utf8");
    const stopAt = (transcript: string): string | null =>
      a.stop(toHookInput({ session_id: id, transcript_path: transcript }, { scope: project })).ask;
    expect(stopAt(path)).toBe(stopAsk(id, 1));

    // A path that will not read (a directory): no turns, and flagged as unread.
    const broken = join(work, "not-a-file");
    mkdirSync(broken);
    const unread = toHookInput({ session_id: id, transcript_path: broken }, { scope: project });
    expect(unread.turnsUnread).toBe(true);
    expect(unread.turns).toEqual([]);
    expect(a.stop(unread).ask).toBeNull();

    // A few more typed messages — enough to pass REASK_TURNS counted from zero,
    // not enough counted from the ask.
    const extra = Math.max(1, T.REASK_TURNS - T.FIRST_ASK_TURNS);
    expect(extra).toBeLessThan(T.REASK_TURNS);
    const more = Array.from({ length: extra }, (_, i) => [typedEntry(`More ${String(i)}.`), assistantEntry("Ok.")]).flat();
    writeFileSync(path, `${jsonl([...start, ...more])}\n`, "utf8");
    expect(stopAt(path)).toBeNull();
    expect(a.counterpart.self.episodeState(id).askedAtTurns).toBe(T.FIRST_ASK_TURNS);
  });

  test("ACCEPTANCE: re-ask on typed turns OR text since the last ask; neither is paced", () => {
    const a = adapter();
    const start = session(T.FIRST_ASK_TURNS, 2, 400);
    const shortReply = (i: number): Record<string, unknown> => assistantEntry(`Reply ${String(i)}: done.`);
    const typedMore = (n: number): Record<string, unknown>[] =>
      Array.from({ length: n }, (_, i) => [typedEntry(`Follow-up ${String(i)}.`), shortReply(i)]).flat();

    // Typed turns: REASK_TURNS short messages since the ask.
    expect(stopOn(a, "s-turns", start)).toBe(stopAsk("s-turns", 1));
    expect(stopOn(a, "s-turns", [...start, ...typedMore(T.REASK_TURNS)])).toBe(stopAsk("s-turns", 1));

    // Text: 2 typed messages, but the assistant wrote past REASK_TEXT_BYTES.
    expect(stopOn(a, "s-bytes", start)).toBe(stopAsk("s-bytes", 1));
    const bytesMore = typedMore(2);
    bytesMore.push(assistantEntry(`Long reply: ${"w".repeat(T.REASK_TEXT_BYTES)}`));
    expect(stopOn(a, "s-bytes", [...start, ...bytesMore])).toBe(stopAsk("s-bytes", 1));

    // Neither: 2 typed messages and a little text.
    expect(stopOn(a, "s-neither", start)).toBe(stopAsk("s-neither", 1));
    expect(stopOn(a, "s-neither", [...start, ...typedMore(2)])).toBeNull();
    const outcomes = a.counterpart.store
      .eventLog({ name: "adapter.ask", limit: 20 })
      .map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>)
      .filter((r) => r["session"] === "s-neither")
      .map((r) => r["outcome"]);
    expect(outcomes).toEqual(["asked", "paced"]);
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

  /**
   * AGAINST WHAT THE HOST SERVES, not the source (review m3). Claude Code cuts
   * each MCP tool description at 2,048 characters (code.claude.com/docs/en/mcp,
   * "For MCP server authors"), and `session_end`'s rendered description is
   * past 3,000 — so a claim that lives only after the cut is a claim the model
   * never reads. What the model does read in full is the input schema, one
   * short description per field.
   */
  const HOST_DESCRIPTION_CAP = 2_048;
  const fieldDescription = (tool: string, ...path: string[]): string => {
    let node = toolSpec(tool)?.inputSchema as Record<string, unknown> | undefined;
    for (const key of path) node = (node?.[key] as Record<string, unknown> | undefined) ?? undefined;
    return String(node?.["description"] ?? "");
  };

  test("the field detail the ask dropped is where the model reads it — inside the host's cut, or on the field itself", () => {
    const served = renderDescription(toolSpec("session_end")!).slice(0, HOST_DESCRIPTION_CAP);
    // Inside the 2,048 characters the host serves:
    expect(served).toContain("`updates` is a FIELD");
    expect(served).toContain("A salience you claim is a floor");
    expect(served).toContain("An entry that claims no salience gets an ordinary default floor");
    // On the fields themselves, which the host serves whole:
    const item = ["properties", "memories", "items", "properties"];
    expect(fieldDescription("session_end", ...item, "updates")).toContain("A field — never written into `content`");
    expect(fieldDescription("session_end", ...item, "salience")).toContain(
      "your claim is the only way what you lived outranks what a sweep noticed",
    );
    expect(fieldDescription("session_end", "properties", "memories")).toContain(
      "Send `[]` when nothing here is worth keeping",
    );
    expect(fieldDescription("session_end", "properties", "handoff")).toContain("not a memory");
    // The chapter's "short and true" is in its first screen.
    expect(renderDescription(toolSpec("chapter")!).slice(0, HOST_DESCRIPTION_CAP)).toContain(
      "a short true chapter beats a deep-sounding one",
    );
  });
});

// ── the one shape ────────────────────────────────────────────────────────────

describe("the one emission shape: non-error feedback (decision 2, 2026-09-24)", () => {
  const ask = stopAsk(UUID, 2);
  const R = { injection: null, ask };

  test("one well-formed object: the person's line, and the ask as Stop additionalContext — no decision, exit 0", () => {
    const d = hostDelivery("stop", R, {});
    expect(d.exitCode).toBe(0);
    expect(d.stderr).toBe("");
    expect(d.dropped).toBeNull();
    // The WHOLE of stdout is the object, or the host reads it as plain text.
    expect(d.stdout.trim()).toBe(d.stdout);
    expect(d.stdout.startsWith("{") && d.stdout.endsWith("}")).toBe(true);
    const parsed = JSON.parse(d.stdout) as Record<string, unknown>;
    expect(parsed).toEqual({
      systemMessage: STOP_HUMAN_LINE,
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: ask },
    });
    expect(HOST_STOP).toBe("Stop");
    // `decision: "block"` beside it is what printed `Stop hook error:`; `reason`
    // is its partner. Neither may come back.
    expect(Object.keys(parsed).sort()).toEqual(["hookSpecificOutput", "systemMessage"]);
  });

  test("the re-fire is refused and nothing-to-ask stays silent — loop protection exactly as before", () => {
    expect(hostDelivery("stop", R, { stop_hook_active: true })).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      dropped: null,
    });
    expect(hostDelivery("stop", { injection: null, ask: null }, {})).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      dropped: null,
    });
    expect(hostDelivery("stop", { injection: null, ask: "" }, {}).stdout).toBe("");
  });

  test("an old `stopAskShape` is read, IGNORED and named — never a reason to stand down", () => {
    for (const value of ["stderr", "json", "STDERR", 42, null]) {
      const loaded = loadConfig({ dataDir: join(work, "store"), stopAskShape: value });
      expect(loaded.ok).toBe(true);
      expect(loaded.config.observer).toBeUndefined();
      expect((loaded.config.retired ?? []).join(" ")).toContain('"stopAskShape" is no longer used');
    }
    expect(loadConfig({ dataDir: join(work, "store") }).config.retired).toBeUndefined();
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

/** Six typed turns (and ~7 KB of text): enough for the first ask on turns. */
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

describe("the one shape, end to end through the hook process", () => {
  const feedbackOf = (stdout: string): Record<string, unknown> =>
    (JSON.parse(stdout) as { hookSpecificOutput: Record<string, unknown> }).hookSpecificOutput;

  test("a due Stop prints the ask as Stop additionalContext and exits 0; the re-fire prints nothing", () => {
    const config = writeConfig();
    const transcript = writeTranscript();
    runHook(config, { hook_event_name: "SessionStart", session_id: "s-json", source: "startup", transcript_path: transcript });
    const stop = runHook(config, { hook_event_name: "Stop", session_id: "s-json", transcript_path: transcript });
    expect(stop.code).toBe(0);
    const parsed = JSON.parse(stop.stdout) as Record<string, unknown>;
    expect(parsed["decision"]).toBeUndefined();
    expect(parsed["reason"]).toBeUndefined();
    expect(parsed["systemMessage"]).toBe(STOP_HUMAN_LINE);
    expect(feedbackOf(stop.stdout)).toEqual({ hookEventName: "Stop", additionalContext: stopAsk("s-json", 1) });
    expect(stop.stderr).not.toContain(STOP_ASK_OPENER);
    const refire = runHook(config, {
      hook_event_name: "Stop",
      session_id: "s-json",
      transcript_path: transcript,
      stop_hook_active: true,
    });
    expect({ code: refire.code, stdout: refire.stdout }).toEqual({ code: 0, stdout: "" });
  });

  test('the owner\'s own config still says "stopAskShape": "stderr" — the Stop is the same one shape, exit 0', () => {
    const config = writeConfig({ stopAskShape: "stderr" });
    const transcript = writeTranscript();
    runHook(config, { hook_event_name: "SessionStart", session_id: "s-stderr", source: "startup", transcript_path: transcript });
    const stop = runHook(config, { hook_event_name: "Stop", session_id: "s-stderr", transcript_path: transcript });
    expect(stop.code).toBe(0);
    expect(stop.stderr).not.toContain(STOP_ASK_OPENER);
    expect(feedbackOf(stop.stdout)).toEqual({ hookEventName: "Stop", additionalContext: stopAsk("s-stderr", 1) });
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

  /**
   * REVIEW M1. At the 9,038-character wake the `ENVELOPE_MAX_CHARS` comment
   * measured, a doctor notice (173) fits and a registry line (177) fits, but the
   * two JOINED did not — and the whole notice was dropped, taking the doctor
   * line, which has no other route to the owner. Now they are fitted in
   * priority order: the doctor's first, the registry's only if it still fits.
   */
  test("M1: at a 9,038-char wake the doctor notice survives, and the registry line is left out rather than costing it", () => {
    const wake = { injection: `${"w".repeat(68)}\n`.repeat(133).slice(0, 9_038), ask: null };
    expect(wake.injection.length).toBe(9_038);
    const tail = "\nrun: counterparts doctor for details";
    const doctor = `counterparts: ${"d".repeat(173 - "counterparts: ".length - tail.length)}${tail}`;
    expect(doctor.length).toBe(173);
    writeFileSync(join(work, "scopes.json"), "{ broken", "utf8");
    // The real sentence, naming the path an ordinary install has (the temp path
    // this test reads from is longer than any real one).
    const registry = describeScopeTrouble(readScopes(join(work, "scopes.json")), "/Users/owner/.counterparts/scopes.json") ?? "";
    expect(registry.length).toBeGreaterThan(150);
    expect(registry.length).toBeLessThan(230);

    // Each alone fits.
    expect(hostDelivery("session-start", wake, {}, [doctor]).dropped).toBeNull();
    expect(hostDelivery("session-start", wake, {}, [registry]).dropped).toBeNull();
    // Together they would not.
    const both = hostDelivery("session-start", wake, {}, [doctor, registry]);
    const parsed = JSON.parse(both.stdout) as Record<string, unknown>;
    expect(parsed["systemMessage"]).toBe(doctor);
    expect(both.stdout.length).toBeLessThanOrEqual(ENVELOPE_MAX_CHARS);
    expect(String((parsed["hookSpecificOutput"] as Record<string, unknown>)["additionalContext"])).toBe(wake.injection);
    // The left-out line is reported, so the silence is explicable.
    expect(both.dropped?.noticeChars).toBe(registry.length);
    expect(both.dropped?.envelopeChars).toBeGreaterThan(ENVELOPE_MAX_CHARS);
  });

  test("M1: with room for both, the doctor notice comes first; with room for neither, the wake goes plain", () => {
    const small = { injection: "WAKE", ask: null };
    const both = hostDelivery("session-start", small, {}, ["doctor line", "registry line"]);
    expect((JSON.parse(both.stdout) as Record<string, unknown>)["systemMessage"]).toBe("doctor line\nregistry line");
    expect(both.dropped).toBeNull();
    // A null doctor notice leaves the registry line alone.
    const onlyRegistry = hostDelivery("session-start", small, {}, [null, "registry line"]);
    expect((JSON.parse(onlyRegistry.stdout) as Record<string, unknown>)["systemMessage"]).toBe("registry line");
    // Nothing fits: the plain wake, and both reported.
    const full = { injection: "w".repeat(ENVELOPE_MAX_CHARS), ask: null };
    const none = hostDelivery("session-start", full, {}, ["doctor line", "registry line"]);
    expect(none.stdout).toBe(full.injection);
    expect(none.dropped?.noticeChars).toBe("doctor line\nregistry line".length);
    // Nothing to say at all is the plain wake with nothing dropped.
    expect(hostDelivery("session-start", small, {}, [null, null])).toEqual(hostDelivery("session-start", small, {}));
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
    expect(out["recorded"]).toBe(true);
    expect(out["handoff"]).toBeUndefined();
    expect(s.counterpart.store.list({ type: "memory" }).length).toBe(before);
    const mark = readSession(store, SESSION)?.nothingNewAt;
    expect(typeof mark).toBe("number");

    // The model's one-line reply to the ask, and the host's next Stop. The
    // pacer advanced when the ask went out, so an answer — this one included —
    // cannot open the next ask; only more typed turns or much more text can.
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

  /**
   * REVIEW M2 — the three repro rows. `memories: []` is an answer WHATEVER
   * happened to the handoff sent with it: recorded, reason `nothing-new`, the
   * handoff's outcome beside it. `nothing-to-clear` is a no-op, not an error.
   */
  test("M2: `memories: []` with a refused handoff is still the answer, recorded, with the handoff's outcome beside it", async () => {
    const rows: [unknown, string, boolean][] = [
      ["", "nothing-to-clear", false],
      ["x".repeat(200 * 1024), "too-large", true],
      [42, "not-text", true],
    ];
    for (const [handoff, handoffReason, isError] of rows) {
      const id = `s-m2-${handoffReason}`;
      recordSession(store, { sessionId: id, scope: project, phase: "start" });
      const s = server();
      const result = await s.call("session_end", { session: id, memories: [], handoff });
      const out = (result.structuredContent ?? {}) as Record<string, unknown>;
      expect({ handoffReason, reason: out["reason"], isError: result.isError === true }).toEqual({
        handoffReason,
        reason: "nothing-new",
        isError,
      });
      expect((out["handoff"] as Record<string, unknown>)["reason"]).toBe(handoffReason);
      expect(out["recorded"]).toBe(true);
      expect(out["deposited"]).toBe(0);
      expect(typeof readSession(store, id)?.nothingNewAt).toBe("number");
    }
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
