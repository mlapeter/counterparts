- **The nightly run no longer leaves a Claude Code transcript behind.** Each night child
  (the dream, the reflection, a write-up owed) used to be saved by Claude Code under
  `~/.claude/projects/`, with the memories it read and the conversation it wrote up,
  kept there until Claude Code's own cleanup (30 days by default) and out of reach of
  Counterparts' own retention. It now runs with `--no-session-persistence`, so nothing is
  saved there. Transcripts from earlier nights are not touched; Claude Code's cleanup
  removes them in time, or you can delete the folder named after your memory store.
