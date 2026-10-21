### Decided by Mike, 2026-10-21 (night children keep no Claude Code transcript)

- Decided by Mike, 2026-10-21 (the site session found it; Mike said to send it): every
  `claude -p` night child runs with `--no-session-persistence`. Why: Claude Code saved each
  child's transcript — memory text and the conversation being written up — under
  `~/.claude/projects/`, outside Counterparts' 3-day/14-day retention, and nothing in the
  package reads it any more (the host cut has come from the child's `stream-json` since
  2026-10-12).
- Decided by the builder, 2026-10-21, lightly held: the plain retry for a host that
  refuses the child's arguments carries the flag too, so on a host too old to know it the
  night does not run, rather than run and leave a transcript. Revisit if a supported host
  turns out to lack the flag.
- Transcripts from earlier nights are left to Claude Code's own cleanup; nothing under
  `~/.claude` is deleted by Counterparts.
- What this costs (2026-10-21, review of #574): `tools/harness night` replays a recorded
  night from its children's transcripts (`night.ts#readChild`, `--dream` /
  `--reflection`), copied from `~/.claude/projects`. No new night leaves those files now;
  the recorded 10-19 corpus still replays. An opt-in recorder is not built: that is
  Mike's call.
