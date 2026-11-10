# `adapters/codex/` — what it still owes (2026-11-09, CX2)

1. **Who "us" is from Codex — DECIDED (Mike, 2026-11-10 09:42): option B.** "us" written from Codex is the owner
   and THAT model, labelled as Codex's the way its own feelings and `saidBy: self` are: a `remember`/`session_end`
   `about: us` is stored with no `us` mark and `meta.readerUs = {host, model}` (`core/reader-note.ts`); a Codex
   revision that would inherit `us` becomes one too. It is recallable, and facts recall labels it ("gpt-x in
   Codex's own note about itself and the owner — not about us"); every door that keeps a Codex `me` note out keeps
   it out (`isReaderSelfRow` covers both): the counterpart's us, meaning-mode "us", the self page and core lane,
   beliefs (a Codex `remember` belief is now refused whatever its `about`), page stories and the wake's us lines.
   A `remark` to `us` and a chapter `about: us` from Codex are refused/dropped, as `me` is (a chapter's copy carries
   no label, §5). The nightly page writer is never handed a Codex `me` or `us` note (counted as omitted). The
   label rides wherever the note surfaces: facts recall, the meaning-mode arc's moments, and the hook's ambient
   recall lines (`recall/render.ts`). A Codex `updates` at a memory about me or us, a core one or a belief is not
   taken (`counterpart-deposit.ts#readerIdentityTarget`): nothing is settled, faded or carried, Codex's words
   stand as its own note, and the result says so (`updatesNotTaken`). A Codex note never blocks the counterpart's
   own write of the same words (the content ledger's `repeats`); Codex repeating the counterpart's is still a repeat.
   Still open (fine for now): with no mark the note can show among a folder's titles in the wake
   (`reads-memories.ts`), as a Codex `me` note can; the null mark loses the reach `us` had as a personal mark;
   the inner doors answer `reader-self-note` / `ABOUT_READER_SELF` for an `us` note too; and the slot detector
   may still PROPOSE (never settle) a Codex note as the newer state of something, for the night to answer.
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
   A Codex chapter `about: me` or `about: us` drops the mark at the door (and says so, `aboutDropped`).
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
12. **Several AIs on one memory.** Mike (11-10) wants eventually a general scheme for several AIs on one memory:
    shared parts vs each agent's own identity, like Claude Code's global/user/project scopes. Recorded only; not built.
