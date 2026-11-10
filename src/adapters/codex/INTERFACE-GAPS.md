# `adapters/codex/` — what it still owes (2026-11-09, CX2)

1. **Who "us" is from Codex.** In this store `us` is the owner and the counterpart. From Codex it may mean the
   owner and the reading model. Unchanged on Mike's word (11-09): a Codex `about: us` is recorded as `us`, feeds
   the core lane and beliefs like any other, and a Codex `remember` belief about `us` is still born. Ambiguous
   places: `remember`/`session_end` `about: us`, `remember`'s `belief: {about: "us"}`, `remark` to `us`, a chapter
   `about: us`, and the reflection reading those. Decide before Codex use grows.
2. **What waits for Claude Code.** The first meeting, the first-launch scope question, plain reminders, the update
   and maintenance lines, the write-up pointer for an owed session (a Codex session that ended unwritten is written
   up by the next Claude Code session in its folder, or the night's catch-up — in the counterpart's voice, about
   Codex's work). Each could be said in Codex later, in the reader's words.
3. **The wake-arrival check.** Claude Code compares what it printed with what its transcript says it injected
   (`claude-code/hooks.ts#checkWakeArrival`); Codex's rollout records our wake as a developer message with
   `hooks.additional_context` — a sibling check could read it.
4. **Feelings and `saidBy: "self"` from Codex — CLOSED in the fix round (2026-11-09).** They never reach the
   feelings table or the `said_by` column; they ride the memory's meta as `readerFeelings` / `readerSaidBy`,
   labelled `{host, model}` (`core/reader-note.ts`). `whose: owner` passes through; `feelingsNow` from Codex records
   only the owner's. Still open: a chapter's own feelings, if any road gives it one, and how the night might one day
   read a reader's labelled feelings at all.
5. **The chapter's memory copy** carries the model (column) but not the host (meta): `appendEpisode` takes no host.
   A Codex chapter `about: me` drops the mark at the door.
6. **Measurements owed**: the stand-down's two signals (`tools/codex-standdown-probe.sh`); tool-call records in
   the rollout (the reader takes `function_call` with `name`/`arguments`, unmeasured); a `compacted` line's shape.
7. **Windows** (`commandWindows` on each hook): a follow-up, with W1's shim lessons.
8. **The single binary** has no `codex-hook` mode: Codex's hook runs from the TypeScript sources (bun or node).
9. **Positional trust.** Codex keys a hook's approval by its index in `hooks.json`. Ours are appended last, but a
   tool that later appends after us, then a `disconnect`, shifts that tool's index and Codex asks again; disconnect
   says so when it sees it.
10. **The MCP server's place before it is bound.** Claude Code's server learns its project from
    `CLAUDE_PROJECT_DIR`; Codex exports nothing like it, so a `remember` before the session's first `session_end` or
    `chapter` (which bind it by id) is filed under the directory Codex started the server in — unmeasured (the TUI's
    cwd, or the app-server daemon's). Check one Codex memory's `origin_scope`; if it is wrong, pass `--scope` from
    the hook's `cwd`, or bind by the registry's newest live Codex session in that directory.
11. **The worker** (`claude-code/bin/runner.ts`) reads no transcript and no Claude Code environment (checked
    11-09): it works over spans and the registry, so a Codex session's boundary runs it unchanged.
