# OL1b progress (lane: the claude.ai surface) — removed or folded before the PR is ready

Brief: ~/counterparts-notes/2026-10-26-briefs/OL1b-claude-ai-surface.md. Three branches off master:

- `feat/claude-ai-trial-rig` (this one): items 1 (report per chat) and 6 (night prompt v2).
- `feat/claude-ai-surface`: items 2 (claude-ai wake), 4 (tool words), 5 (Wake Counterparts prompt).
- `feat/claude-ai-dreams`: items 3 (last dream / last night, dreams by meaning) and 7 (first meeting over the door).

## This branch

Done:
- 1: `call-log.ts#summarizeChats` keys by the session `wake` minted; unnamed calls counted per connection with
  `beforeWake`. `report.ts` prints per chat. Real-path test through the door (remote-http.test.ts).
- 6: `trial.sh` NIGHT_PROMPT v2; test in trial-script.test.ts.

Next: PR.

Learned:
- A chat's "wake first" is vacuous once rows are keyed by the minted session; the honest measure of a chat that
  never woke is the unnamed calls before any wake on a connection.
