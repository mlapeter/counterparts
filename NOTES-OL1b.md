# OL1b progress (lane: the claude.ai surface) — removed or folded before the PR is ready

Brief: ~/counterparts-notes/2026-10-26-briefs/OL1b-claude-ai-surface.md. Three branches off master:

- `feat/claude-ai-trial-rig`: items 1, 6 — PR #641.
- `feat/claude-ai-surface`: items 2, 4, 5.
- `feat/claude-ai-dreams` (this one): items 3 and 7.

## This branch

Done:
- 3: recall handle "last dream" / "last night" (`server.ts#lastNightTool`, `nights.ts#readLastNight`): dream
  title + journal whole + what it did, and the reflection after it whole. A drm_/rfl_ handle alone now reads
  whole too (among `ids` still a summary). Dreams beside a question's answer (`nights.ts#nightsForQuestion`):
  by the reflection entry the answer showed, by shared content words, or the newest when the question names
  dreaming. Words, not vectors (a dream index would be a store-format change; flagged).
  Tests: test/claude-ai-dreams.test.ts through the door.

Next: 7 (meet from a cold first chat over the door), then full bun test, fold, PR.
