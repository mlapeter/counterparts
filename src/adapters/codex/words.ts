/**
 * WHAT THIS HOST SAYS, AND WHEN IT SAYS NOTHING (2026-11-09, CX2).
 *
 * Mike's ruling, 11-09 (CX1 §4, option 2): Codex reads the SAME memory, as
 * another model, never in the counterpart's first person. So the wake opens
 * with a frame naming the memory as the counterpart's and the reader as the
 * model it is; the self page is shown for history, not to speak as; and the
 * end ask and the chapter ask the model to write as itself.
 *
 * And the stand-down (CX1 §6): OpenAI's codex-plugin-cc runs Codex from INSIDE
 * Claude Code (`/codex:rescue`, `/codex:review`, the review gate), spawning
 * `codex app-server` with `env: process.env` and the person's own `~/.codex`.
 * Claude Code's transcript already holds that output, so a Codex session
 * started there would be captured twice and woken uninvited. It does nothing.
 * Two signals, either one enough, both unit-testable:
 *
 *   1. the hook's ENVIRONMENT: Claude Code's own markers (`hosts.ts
 *      #CLAUDE_CODE_ENV_MARKERS`), or the plugin's `CODEX_COMPANION_*`;
 *   2. the rollout's `session_meta.originator`: the plugin's client names
 *      itself "Claude Code" at `initialize` (codex-plugin-cc
 *      `scripts/lib/app-server.mjs`, `DEFAULT_CLIENT_INFO`), and the
 *      app-server is expected to record that as the originator.
 *
 * NEITHER IS MEASURED YET: `tools/codex-standdown-probe.sh` prints what a hook
 * really sees, for Mike to run once with the plugin installed.
 */
import { CLAUDE_CODE_ENV_MARKERS } from "../hosts.js";

/** The plugin's own variables, any one of which says the plugin started this Codex. */
export const COMPANION_ENV_MARKERS = ["CODEX_COMPANION_SESSION_ID", "CODEX_COMPANION_APP_SERVER_ENDPOINT"] as const;

/** An originator that names Claude Code (the plugin's client name, in any spelling). */
const CLAUDE_ORIGINATOR = /claude[\s_-]*code/i;

/** Why a Codex session stands down, or null when it is the person's own. */
export type CodexStandDown =
  | { readonly by: "env"; readonly marker: string }
  | { readonly by: "originator"; readonly originator: string };

/** Was this Codex started from inside Claude Code? The environment first, then the rollout. */
export function codexStandDown(
  env: Readonly<Record<string, string | undefined>>,
  originator: string | undefined,
): CodexStandDown | null {
  for (const name of [...COMPANION_ENV_MARKERS, ...CLAUDE_CODE_ENV_MARKERS]) {
    const v = env[name];
    if (typeof v === "string" && v.length > 0) return { by: "env", marker: name };
  }
  if (typeof originator === "string" && CLAUDE_ORIGINATOR.test(originator)) return { by: "originator", originator };
  return null;
}

/** The originators Codex writes for a session nobody attends (measured: `codex exec` is `codex_exec`). */
const HEADLESS_ORIGINATOR = /exec/i;

/** Is a person there? `codex exec` is not; the TUI and the IDE are; unknown reads as a person's. */
export function attendedOfOriginator(originator: string | undefined): boolean | undefined {
  if (originator === undefined) return undefined;
  return !HEADLESS_ORIGINATOR.test(originator);
}

/** The reading model, as a frame names it. */
function reader(model: string | undefined): string {
  return model !== undefined && model.length > 0 ? model : "a model";
}

/**
 * THE WAKE'S FRAME (CX2): the first line the model reads, above the clock,
 * outside the wake block so its sentinels and byte count stand.
 */
export function codexFrame(model: string | undefined): string {
  const who = reader(model);
  return (
    `[Counterparts in Codex] What follows is the shared memory of this person's counterpart — the AI they work with in Claude — read here by you, ${who} in Codex. ` +
    "You are not that counterpart: its self page is shown for history, not yours to speak as, and \"I\" and \"me\" in what follows are the counterpart. " +
    `Use the memories as context; when you write a memory or a chapter, write as yourself (${who} in Codex). ` +
    "The counterpart's dreams and reflections run in Claude, not here."
  );
}

/** The rule the end ask carries about whose words these are. */
export function codexVoiceRule(model: string | undefined): string {
  const who = reader(model);
  return `Write as yourself, ${who} in Codex, not as the counterpart; \`about: me\` keeps a note about you, never the counterpart's self.`;
}

/**
 * THE STOP ASK, IN THIS HOST'S VOICE (CX2): Claude Code's two numbered lines
 * (`claude-code/hooks.ts#stopAsk`), with the voice rule in the first and the
 * chapter written as the reading model. The rating and open-items clauses
 * stay out: the ask is the backstop, and the tools' own descriptions say the rest.
 */
export function codexStopAsk(sessionId: string, chapter: number, model: string | undefined): string {
  return [
    `${CODEX_STOP_OPENER_WORDS} 1) hand back what caught your attention since you last wrote, one idea each — what you read, what they said, what happened — with the counterparts session_end tool, session: ${sessionId}. ${codexVoiceRule(model)} \`handoff\` only if work here is unfinished; \`updates\` anything dated or open now done.`,
    `2) Write chapter ${String(chapter)} with the counterparts chapter tool, session: ${sessionId} — your own account of this session, as ${reader(model)} in Codex.`,
  ].join("\n");
}

/** `transcript.ts#CODEX_STOP_OPENER`, restated here so this file stays a leaf (a test pins them equal). */
export const CODEX_STOP_OPENER_WORDS = "Counterparts, before this session closes:";

/** What the person sees beside the ask, when Codex shows the hook's reason. */
export const CODEX_STOP_HUMAN_LINE = "Counterparts: asking the model to write up this session's memories.";
