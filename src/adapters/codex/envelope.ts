/**
 * WHAT A CODEX HOOK PRINTS (2026-11-09, CX2) — only the shapes measured on
 * Codex 0.167 (CX1 §0b), nothing carried over from Claude Code's envelope:
 *
 *   - SessionStart / UserPromptSubmit: `{"hookSpecificOutput":{"hookEventName":
 *     …,"additionalContext":…}}`. Measured: a 9,168-byte wake arrived whole as
 *     one developer-role message, and a prompt's context as its own message
 *     before the reply. Codex also reads plain stdout as context, but stdout
 *     that LOOKS like JSON and does not parse fails the hook (codex-rs
 *     `hooks/src/events/common.rs`), so this always prints one whole object.
 *   - Stop: `{"decision":"block","reason":<ask>}`. Measured: Codex continued
 *     with the reason as a user-role `<hook_prompt …>` message, and re-fired
 *     Stop with `stop_hook_active: true`, which prints nothing here.
 *   - SessionEnd: nothing.
 *
 * Always exit 0. No `systemMessage`: Codex parses one at SessionStart, but where
 * it shows is unmeasured, and nothing here needs the person's eye yet.
 */
import type { CodexHookName } from "./adapter.js";

const EVENT_NAMES: Record<"session-start" | "user-prompt-submit", string> = {
  "session-start": "SessionStart",
  "user-prompt-submit": "UserPromptSubmit",
};

/** The stdout for this event: one JSON object, or the empty string. */
export function codexDelivery(
  name: CodexHookName,
  result: { readonly injection: string; readonly ask: string | null },
  payload: Readonly<Record<string, unknown>>,
): string {
  if (name === "session-start" || name === "user-prompt-submit") {
    if (result.injection.length === 0) return "";
    return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT_NAMES[name], additionalContext: result.injection } });
  }
  if (name === "stop") {
    if (payload["stop_hook_active"] === true || result.ask === null || result.ask.length === 0) return "";
    return JSON.stringify({ decision: "block", reason: result.ask });
  }
  return "";
}
