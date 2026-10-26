# OL1a — hookless share carry (progress file; folded or removed before the PR is ready)

Branch `fix/hookless-share-carry` from origin/master eacdafda. Brief:
`~/counterparts-notes/2026-10-26-briefs/OL1a-hookless-share-carry.md`.

## Step 1 — the trace (done, before any change)

Bug: a claude.ai routine (night) reflected and left a share; the next chat's wake did not carry it; it
stayed `offered`.

Where a share is carried today (every caller of `Reflections.carryLine` / `pendingShare`):

1. `src/adapters/claude-code/hooks.ts#dreamLines` — Claude Code's UserPromptSubmit. `pendingShare`
   (newest `offered`, from another session) → reads the reflecting session's registry record →
   carries only when the record is missing, ended, or quiet past `SESSION_TTL_MS` (4 h,
   `sessions.ts#isLive`).
2. `src/adapters/claude-code/hooks.ts#nightHandBack` — the hand-back of Claude Code's own headless
   nightly run (`dreams.nightRun()`), claimed once across sessions.

Nothing else. The hookless wake — `src/adapters/mcp/server.ts#wakeTool`, the one Desktop chat and
claude.ai (`adapters/remote/`, same McpServer) both run — composes the wake
(`lifecycle.composeWake`), plain reminders, worker spawn, the dream ASK line, notices, the first
meeting, the write-up pointer. **It never calls `pendingShare` or `carryLine`.** `composeWake` /
core handoff carry no share either (grep: no share_state reader on that path).

So the cause is one layer below the brief's guess:

- **Primary:** the hookless wake has no share carry at all. On a claude.ai-only store (the trial)
  no code path will ever carry a share; it stays `offered` forever. The `nightHandBack` path does
  not apply either: claude.ai's routine is a chat calling dream/reflect over MCP, not
  `dreams.nightRun()` (Claude Code's spawned run).
- **Second, and it would bite as soon as the wake carried with Claude Code's rule:** a hookless
  session's registry record is started at `wake` (`lc.noteSession("start")`) and refreshed by each
  call that NAMES it (`bindDesktopCall` → `sessions.ts#touchDesktopSession`, a `boundary` write);
  nothing ever writes an `end` (no Stop/SessionEnd; `session_end`/`chapter` don't end the record).
  So the routine's session reads LIVE for 4 h after its last call and is never ended. Under the
  "reflecting session ended or quiet" rule, a chat opened within 4 h of the routine's last call
  would not carry it. (This is the brief's guess, true but not the first thing in the way.)
  [Corrected: the first version of this note said MCP calls never write a boundary; they do.]
- Side fact: on a store shared with Claude Code (Mike's local, Desktop chat), a Claude Code prompt
  more than 4 h after a Desktop reflection's wake does carry it via (1); a Desktop wake never does.

`pendingShare` already filters `state = 'reflected'` (the reflection's `finish` landed) and
`row.session !== input.session`; `carryLine` is an atomic claim (`ifShareState: "offered"`), so
two wakes racing carry it once.

## Next

- Fix (pending the design check): carry in `wakeTool`.
- Real-path test through the HTTP door; Claude Code unchanged test.
