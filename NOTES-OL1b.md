# OL1b progress (lane: the claude.ai surface) — removed or folded before the PR is ready

Brief: ~/counterparts-notes/2026-10-26-briefs/OL1b-claude-ai-surface.md. Three branches off master:

- `feat/claude-ai-trial-rig`: items 1, 6 — PR #641.
- `feat/claude-ai-surface` (this one): items 2 (claude-ai wake), 4 (tool words), 5 (Wake Counterparts prompt).
- `feat/claude-ai-dreams`: items 3 (last dream / last night, dreams by meaning) and 7 (first meeting over the door).

## This branch

Done:
- 2: `mcp/chat-wake.ts` (session line, share slot for OL1a, `chatLanesFirst`, `sameYouLine` seam);
  `server.ts#wakeTool` branches on CLAUDE_AI_HOST; no dream line there. Desktop's wake unchanged.
- 4: CLAUDE_AI_WAKE reworded (describes, does not command); `CLAUDE_AI_WORDS` for remember, recall,
  status, session_end, chapter (summary/admission only). Annotations unchanged.
- 5: `CLAUDE_AI_START_PROMPT` "Wake Counterparts" via `startPromptFor(host)`.
- Tests: test/claude-ai-surface.test.ts (through the door); two remote-http assertions updated on purpose.

Next: full bun test, fold this file, PR.

## Flagged: readOnly honesty (recommendation: do not mark recall or wake readOnly)

For marking recall readOnly: claude.ai sorts read-only tools apart ("Memory status" alone today) and may
ask less before calling them; recall changes no memory's words and adds no memory; the writes it causes are
bookkeeping a person would call "reading".
Against (and the 2026-10-14 annotation comment already drew this line): recall records what it delivered
for the session (`Counterpart#noteAsked`, a gate record) and the boundary's credit pass strengthens what was
opened or quoted, so a recall changes what later fades and what a later wake shows. wake mints a session,
writes its registry record, starts the worker, commits the first-meeting line and claims plain reminders.
MCP's hint is "does not modify its environment"; a host is allowed to skip confirmation on it. Marking
either would stretch the hint to win a UI placement. If the placement matters, the honest route is a recall
that records nothing (an observer read) — a design change, not an annotation.
