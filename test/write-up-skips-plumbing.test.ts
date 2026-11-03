/**
 * A WRITE-UP SKIPS THE PLUMBING (2026-11-03, WP1).
 *
 * In the Dana re-run the night's catch-up wrote a refused tool call into memory —
 * "Declined permission to mark a note delivered (3 Mar 2026)" — and it then headed day
 * 4's wake. Tool calls, permission prompts, refusals and hook text are the machinery
 * between the person and the counterpart, not something that happened between them.
 *
 * Held here on the real path: a Claude Code transcript in the host's own shapes (a reply
 * with a `reflect` call, the person declining it, the host's rejected `tool_result` and
 * its `[Request interrupted by user for tool use]` line, a hook's output as user text, and
 * the person going on) is read by the real Stop hook's payload path, captured, ended; the
 * real catch-up then grants it to a runner whose child fetches each part through the real
 * write-up door and hands back every piece it was shown, word for word. Nothing of the
 * refusal or the hook reaches the part or the memories; the person's words in that same
 * part do, and so does what they said about the prompt. The child is also told, in the
 * prompt and in every part's `next`, to leave plumbing out — the half a reader cannot
 * filter, because it is the session's own words.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No real `claude`
 * starts; the child is an injected starter driving the real MCP server as the runner.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toHookInput } from "../src/adapters/claude-code/bin/hook.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { runCatchUp } from "../src/adapters/claude-code/night-catch-up.js";
import { claudeCodeSeat, openNightCounterpart } from "../src/adapters/claude-code/night-run.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import { WRITE_UP_PLUMBING_RULE, recordSession } from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";

let root: string;
let dir: string;
let proj: string;
const closers: (() => void)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-wp1-")));
  dir = join(root, "store");
  proj = join(root, "notes");
  for (const d of [dir, proj]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const close of closers.splice(0)) {
    try {
      close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const config = (): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: 9_000 });
const SESSION = "dana-notes-1";

// ── the transcript, in the host's shapes (synthetic words) ──────────────────

const SAID_FIRST = "Biscuit's surgery went well, the vet says the knee looks great. You're the first one I've told.";
const SAID_AFTER = "She has to rest for six weeks, which is going to be hard. She loves the park.";
const SAID_ABOUT_PROMPT = "And why do you keep asking me to allow that memory thing?";
const REPLY_FIRST = "That's such good news. How is she doing now?";
const REPLY_AFTER = "Six weeks is long for a dog who loves the park. Short sniff walks on a lead can help.";
/** The host's own line after a declined permission prompt — measured on the owner's transcripts, 11-03. */
const INTERRUPT_FOR_TOOL = "[Request interrupted by user for tool use]";
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
/** A hook's output, should a build ever write it as user text. */
const HOOK_TEXT = "<system-reminder>\nUserPromptSubmit hook additional context: Counterparts: a note from yesterday is waiting to be passed along.\n</system-reminder>";

let seq = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const typed = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  uuid: uuid(),
  origin: { kind: "human" },
  promptSource: "typed",
  message: { role: "user", content: text },
});
const bare = (text: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  uuid: uuid(),
  message: { role: "user", content: [{ type: "text", text }] },
});
const replied = (text: string, call?: string): Record<string, unknown> => ({
  type: "assistant",
  uuid: uuid(),
  message: {
    role: "assistant",
    model: "claude-test",
    content: [
      { type: "text", text },
      ...(call === undefined ? [] : [{ type: "tool_use", id: call, name: "mcp__counterparts__reflect", input: { told: "mem_0123456789ab" } }]),
    ],
  },
});
const refused = (call: string): Record<string, unknown> => ({
  type: "user",
  userType: "external",
  uuid: uuid(),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: call, is_error: true, content: REJECTED }] },
  toolUseResult: `Error: ${REJECTED}`,
});
const hookAttachment = (): Record<string, unknown> => ({
  type: "attachment",
  uuid: uuid(),
  attachment: { type: "hook_additional_context", hookEvent: "UserPromptSubmit", content: ["Counterparts: a note is waiting."] },
});

const TRANSCRIPT = [
  typed(SAID_FIRST),
  replied(REPLY_FIRST, "toolu_01"),
  refused("toolu_01"),
  bare(INTERRUPT_FOR_TOOL),
  hookAttachment(),
  bare(HOOK_TEXT),
  typed(`${SAID_AFTER} ${SAID_ABOUT_PROMPT}`),
  replied(REPLY_AFTER),
];

/** The session, lived through the real hooks: a start, a Stop over the transcript file, an end. */
function lived(): void {
  const path = join(root, `${SESSION}.jsonl`);
  writeFileSync(path, TRANSCRIPT.map((e) => JSON.stringify(e)).join("\n"));
  const a = openAdapter(config(), { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 4242 }) });
  try {
    recordSession(dir, { sessionId: SESSION, scope: proj, phase: "start" });
    const input = toHookInput(
      { hook_event_name: "Stop", session_id: SESSION, cwd: proj, transcript_path: path, stop_hook_active: false },
      { scope: proj, dataDir: dir },
    );
    a.stop(input);
    a.sessionEnd(
      toHookInput({ hook_event_name: "SessionEnd", session_id: SESSION, cwd: proj, transcript_path: path, reason: "exit" }, { scope: proj, dataDir: dir }),
    );
  } finally {
    a.counterpart.close();
  }
}

// ── the catch-up's child: fetch each part, hand back every piece word for word ──

interface Seen {
  stdin: string;
  parts: string[];
  next: string[];
}

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/** Each piece of a part as written: the marks off, the separator split. */
function pieces(part: string): string[] {
  return part
    .split("\n\n---\n\n")
    .map((p) => p.replace(/^\[its reply\] /, "").replace(/^\[a note it jotted\] /, "").trim())
    .filter((p) => p.length > 0);
}

function echoingChild(seen: Seen): (plan: ChildPlan) => Promise<ChildResult> {
  return async (plan) => {
    seen.stdin = plan.stdin;
    const runner = plan.env[SESSION_ENV] as string;
    const ids = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1] as string);
    const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
    try {
      for (const id of ids) {
        for (let guard = 0; guard < 12; guard++) {
          const f = payload(await s.call("session_end", { session: runner, writeUp: id }));
          if (f["reason"] !== "part") break;
          const text = String(f["text"]);
          seen.parts.push(text);
          seen.next.push(String(f["next"]));
          const memories = pieces(text).map((content) => ({ content, kind: "fact" }));
          const a = payload(await s.call("session_end", { session: runner, writeUp: id, part: f["part"], memories }));
          if (a["reason"] !== "part-written") break;
        }
      }
    } finally {
      s.counterpart.close();
    }
    return { code: 0, timedOut: false, error: null };
  };
}

function bodies(): string {
  const c = openNightCounterpart(config());
  try {
    return c.store
      .list({ type: "memory" })
      .map((id) => c.store.row(id))
      .map((r) => `${r?.title ?? ""}\n${r?.body ?? ""}`)
      .join("\n\n");
  } finally {
    c.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the night's write-up skips the plumbing (WP1)", () => {
  test("a refused tool call and a hook's text never reach the part or memory; the person's words in that part do", async () => {
    lived();
    const seen: Seen = { stdin: "", parts: [], next: [] };
    const report = await runCatchUp({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "cup_wp1",
      scope: dir,
      seat: claudeCodeSeat({ config: config(), open: () => openNightCounterpart(config()), startCatchUp: echoingChild(seen) }),
      now: () => Date.now(),
    });
    expect(report).toMatchObject({ state: "done", written: 1 });
    expect(seen.parts.length).toBeGreaterThan(0);
    const served = seen.parts.join("\n\n");

    // The host's line about the refusal, its rejected result and the hook's output:
    // in neither what the child was handed nor what was written.
    const memory = bodies();
    for (const plumbing of [INTERRUPT_FOR_TOOL, "Request interrupted", "doesn't want to proceed", "hook additional context", "waiting to be passed along"]) {
      expect(`${plumbing} served: ${String(served.includes(plumbing))}`).toBe(`${plumbing} served: false`);
      expect(`${plumbing} written: ${String(memory.includes(plumbing))}`).toBe(`${plumbing} written: false`);
    }
    // What the person said, in that same part — the prompt they asked about too — and
    // what the session said back.
    for (const said of [SAID_FIRST, SAID_AFTER, SAID_ABOUT_PROMPT, REPLY_FIRST, REPLY_AFTER]) {
      expect(`${said} served: ${String(served.includes(said))}`).toBe(`${said} served: true`);
      expect(`${said} written: ${String(memory.includes(said))}`).toBe(`${said} written: true`);
    }

    // The half no reader can filter — a reply's own words about a refusal — is the
    // prompt's: the child is told in its prompt and in every part's `next`.
    expect(seen.stdin).toContain(WRITE_UP_PLUMBING_RULE);
    expect(seen.next.every((n) => n.includes(WRITE_UP_PLUMBING_RULE))).toBe(true);
    expect(WRITE_UP_PLUMBING_RULE).toContain("unless the person talked about them");
  });
});
