/**
 * Prompts typed while the model is still working (2026-09-24).
 *
 * The host writes those as `attachment` lines (`queued_command`,
 * `commandMode: "prompt"`, `origin.kind: "human"`), never as user entries.
 * They are the person's words: a typed turn for pacing and a turn for capture,
 * at the position they stand in, once each.
 *
 * Synthetic text in the host's real shapes (Claude Code 2.1.26x–2.1.28x,
 * `src/adapters/claude-code/NOTES.md` §"Prompts typed mid-turn"). Hermetic:
 * every test makes its own temp directory and removes it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import { substanceOf } from "../src/adapters/claude-code/hooks.js";
import { openAdapter, parseTranscript } from "../src/adapters/claude-code/index.js";
import type { ClaudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import type { SpawnPlan } from "../src/adapters/claude-code/spawn.js";
import { recordSession } from "../src/adapters/sessions.js";

const ENV = "COUNTERPARTS_DATA_DIR";

let dir: string;
let priorEnv: string | undefined;
const closers: (() => void)[] = [];

beforeEach(() => {
  priorEnv = process.env[ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-queued-"));
  process.env[ENV] = dir;
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  rmSync(dir, { recursive: true, force: true });
});

// ── the shapes ──────────────────────────────────────────────────────────────

const TYPED = "Let's split the parser into its own module and keep the old entry point as a shim.";
const QUEUED = "Also keep the old error messages word for word, the docs quote them.";
const LATER = "Good. Now run the suite and tell me what broke.";

let seq = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const typedEntry = (text: string, promptSource = "typed"): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  uuid: uuid(),
  origin: { kind: "human" },
  promptSource,
  message: { role: "user", content: text },
});

const assistantEntry = (text: string): Record<string, unknown> => ({
  type: "assistant",
  uuid: uuid(),
  message: { role: "assistant", model: "claude-test", content: [{ type: "text", text }] },
});

const toolUse = (): Record<string, unknown> => ({
  type: "assistant",
  uuid: uuid(),
  message: { role: "assistant", model: "claude-test", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
});

/** The attachment line the host writes for a prompt typed mid-turn. */
const queuedEntry = (prompt: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "attachment",
  userType: "external",
  isSidechain: false,
  parentUuid: uuid(),
  uuid: uuid(),
  timestamp: "2026-09-24T10:00:00.000Z",
  attachment: {
    type: "queued_command",
    prompt,
    commandMode: "prompt",
    origin: { kind: "human" },
    source_uuid: uuid(),
    timestamp: "2026-09-24T10:00:00.000Z",
    ...over,
  },
});

/** A hook attachment, which stays skipped. */
const hookAttachment = (): Record<string, unknown> => ({
  type: "attachment",
  uuid: uuid(),
  attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", content: "context", stdout: "context" },
});

const jsonl = (entries: readonly Record<string, unknown>[]): string =>
  entries.map((e) => JSON.stringify(e)).join("\n");

// ── an adapter over a temp store, for capture ───────────────────────────────

function adapter(): ClaudeCodeAdapter {
  const a = openAdapter(
    { dataDir: dir, injectionBudgetBytes: 9000, owner: true },
    { command: "/bin/true", args: ["runner"], spawner: (_p: SpawnPlan) => ({ pid: 4242 }) },
  );
  closers.push(() => a.counterpart.close());
  return a;
}

/** A Stop from the host over the file at `path`, through the real payload path. */
function stopOver(a: ClaudeCodeAdapter, path: string): ReturnType<ClaudeCodeAdapter["stop"]> {
  const input = toHookInput(
    { hook_event_name: "Stop", session_id: "s1", cwd: dir, transcript_path: path, stop_hook_active: false },
    { scope: "proj", dataDir: dir },
  );
  return a.stop({ ...input, at: "2026-01-01" });
}

/** Every captured span's text, both kinds. */
function capturedText(a: ClaudeCodeAdapter): string {
  const spans = a.counterpart.spans;
  return [...spans.spans("proj"), ...spans.assistantSpans("proj")].map((s) => s.text).join("\n\n");
}

const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

// ═══════════════════════════════════════════════════════════════════════════

describe("a prompt typed mid-turn is a typed turn", () => {
  test("(a) a queued prompt that exists only as an attachment is one typed turn, where it stands", () => {
    const read = parseTranscript(
      jsonl([typedEntry(TYPED), toolUse(), queuedEntry(QUEUED), assistantEntry("Done, and the messages are unchanged.")]),
    );
    expect(read.turns.map((t) => [t.role, t.source, t.text])).toEqual([
      ["user", "conversation", TYPED],
      ["user", "conversation", QUEUED],
      ["assistant", "conversation", "Done, and the messages are unchanged."],
    ]);
    expect(substanceOf(read.turns).turns).toBe(2);
  });

  test("(a) it is captured", () => {
    const a = adapter();
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    const path = join(dir, "t.jsonl");
    writeFileSync(path, jsonl([typedEntry(TYPED), toolUse(), queuedEntry(QUEUED), assistantEntry("Done.")]));
    stopOver(a, path);
    expect(occurrences(capturedText(a), QUEUED)).toBe(1);
    expect(occurrences(capturedText(a), TYPED)).toBe(1);
  });

  test("(b) the same prompt written again later as a queued user entry is one turn, the first", () => {
    const read = parseTranscript(
      jsonl([typedEntry(TYPED), queuedEntry(QUEUED), assistantEntry("On it."), typedEntry(QUEUED, "queued"), assistantEntry("Done.")]),
    );
    expect(read.turns.filter((t) => t.text === QUEUED).length).toBe(1);
    expect(read.turns.map((t) => t.text)).toEqual([TYPED, QUEUED, "On it.", "Done."]);
    expect(substanceOf(read.turns).turns).toBe(2);
  });

  test("(b) one twin consumes one queued prompt; the same words typed the ordinary way still count", () => {
    const read = parseTranscript(
      jsonl([
        queuedEntry("yes"),
        typedEntry("yes", "queued"),
        typedEntry("yes", "queued"),
        typedEntry("yes"),
      ]),
    );
    expect(substanceOf(read.turns).turns).toBe(3);
  });

  test("a queued user entry with no attachment twin is still a turn", () => {
    const read = parseTranscript(jsonl([typedEntry(TYPED), assistantEntry("Working."), typedEntry(QUEUED, "queued")]));
    expect(substanceOf(read.turns).turns).toBe(2);
  });

  test("(c) queued work that is not the person typing is not a turn", () => {
    const notification = queuedEntry("<task-notification>\n<status>completed</status>\n</task-notification>", {
      commandMode: "task-notification",
      origin: undefined,
    });
    const peer = queuedEntry("[Subagent hand-back] The report follows.", {
      origin: { kind: "peer", from: "a0000000000000001" },
      isMeta: true,
    });
    const bash = queuedEntry("git status", { commandMode: "bash" });
    const slash = queuedEntry("/compact keep the parser notes");
    const noOrigin = queuedEntry("no origin at all", { origin: undefined });
    const read = parseTranscript(jsonl([notification, peer, bash, slash, noOrigin, hookAttachment()]));
    expect(read.turns).toEqual([]);
    expect(read.corrupt).toBe(0);
  });

  test("a path that starts with a slash is not a slash command", () => {
    const read = parseTranscript(jsonl([queuedEntry("/src/parser.ts is where it breaks")]));
    expect(substanceOf(read.turns).turns).toBe(1);
  });

  test("(e) substanceOf counts each queued prompt once, adjacent ones apart", () => {
    const read = parseTranscript(jsonl([typedEntry(TYPED), toolUse(), queuedEntry(QUEUED), queuedEntry(LATER)]));
    expect(substanceOf(read.turns)).toEqual({
      turns: 3,
      bytes: Buffer.byteLength(TYPED + QUEUED + LATER, "utf8"),
    });
  });

  test("(e) a queued prompt with a pasted image is one turn; the image stays the blind spot", () => {
    const read = parseTranscript(
      jsonl([
        queuedEntry(
          [
            { type: "text", text: QUEUED },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
          { imagePasteIds: [1] },
        ),
      ]),
    );
    expect(read.turns.map((t) => t.text)).toEqual([QUEUED]);
    expect(substanceOf(read.turns).turns).toBe(1);
  });
});

describe("the capture cursor across a queued prompt", () => {
  test("(d) a cursor between a queued attachment and later entries resumes with no loss and no repeat", () => {
    const a = adapter();
    recordSession(dir, { sessionId: "s1", scope: "proj", phase: "start" });
    const path = join(dir, "t.jsonl");
    writeFileSync(path, `${jsonl([typedEntry(TYPED), assistantEntry("Splitting it now."), queuedEntry(QUEUED)])}\n`);

    const first = stopOver(a, path);
    expect(first.ok).toBe(true);
    expect(a.counterpart.spans.cursor("proj", "s1")).toBe(3);

    // The turn goes on: the assistant answers, the host writes the queued
    // prompt's twin, and the person types something new.
    appendFileSync(
      path,
      `${jsonl([assistantEntry("Kept the messages."), typedEntry(QUEUED, "queued"), typedEntry(LATER), assistantEntry("Two failures.")])}\n`,
    );
    const second = stopOver(a, path);
    expect(second.ok).toBe(true);
    const turns = toHookInput({ transcript_path: path, session_id: "s1" }, { scope: "proj", dataDir: dir }).turns ?? [];
    expect(turns.length).toBe(6);
    expect(a.counterpart.spans.cursor("proj", "s1")).toBe(turns.length);

    const text = capturedText(a);
    for (const said of [TYPED, QUEUED, LATER, "Splitting it now.", "Kept the messages.", "Two failures."]) {
      expect(`${said}: ${occurrences(text, said)}`).toBe(`${said}: 1`);
    }
  });

  test("the turn list only grows as the file grows", () => {
    const lines = [
      typedEntry(TYPED),
      toolUse(),
      queuedEntry(QUEUED),
      assistantEntry("Kept."),
      typedEntry(QUEUED, "queued"),
      queuedEntry(LATER),
      typedEntry(LATER),
      assistantEntry("Done."),
    ];
    let before: string[] = [];
    for (let n = 1; n <= lines.length; n += 1) {
      const now = parseTranscript(jsonl(lines.slice(0, n))).turns.map((t) => t.text);
      expect(now.slice(0, before.length)).toEqual(before);
      before = now;
    }
  });
});
