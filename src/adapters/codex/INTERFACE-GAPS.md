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
   **Held in core since the review of a7c9bd74** (two predicates in `core/reader-note.ts`: `isReaderSelfRow` for a
   Codex note, `isCounterpartIdentityRow` for a memory about me or us, a core one or a belief; `isReaderHostRow`
   adds any row with `meta.host`): sleep's dedup never merges across a reader boundary; `reconsolidation.ts`'s
   `settle` and `supersede` (the one door a settle, a write's `updates`, a slot, a merge, a fold and interference
   cross) refuse `reader-over-identity` when words written from a reader host would stand over the counterpart's
   identity, and a settle FROM a reader host touching identity at all; the dream never merges, gists, folds or
   carries a Codex note, and the dream's and the reflection's bundles label it; a Codex revision of its own note
   stays its own (me and us); a Codex `remark` never moves an identity row's mark, and a Codex `remember.core`
   is refused; a Codex chapter carries its host (`meta.hosts`, additive) and day's end skips it; a write's
   neighbours label a Codex note.
   **Every row Codex writes carries `meta.host`** (re-review of 208c9b45) — its plain writes, its notes, and its
   chapters' summaries (from the episode's `hosts`) — and every identity guard reads `isReaderHostRow`: the dream's
   merge, gist/fold sources, fold parts, belief-candidate sources and nominate-core; the reflection's cites and
   marks; `fileSupport`; the core lane; `setAbout`/`markAbout`; dedup; the content ledger's `repeats`; and the page
   writer's omit (all of Codex's rows, not only its notes). The dream's episodes and the reflection's chapters and
   timeline skip a Codex chapter, as day's end does; the dream's and the reflection's items label any Codex row
   ("written by gpt-x in Codex — not mine"). Accepted for now: an owner-said fact Codex recorded can't be settled
   over the counterpart's identity by the counterpart either (only the owner's door can), and the slot detector's
   nightly confirm will refuse such a pair each night it proposes it.
   Still open (fine for now): with no mark the note can show among a folder's titles in the wake
   (`reads-memories.ts`), as a Codex `me` note can; the null mark loses the reach `us` had as a personal mark;
   the inner doors answer `reader-self-note` / `ABOUT_READER_SELF` for an `us` note too; the slot detector
   may still PROPOSE a Codex note as the newer state of something (a confirm crosses `supersede`, which refuses
   it over identity); a Codex chapter still reads as "my journal" in facts recall; a Codex `remove` of the counterpart's memories is allowed (Mike's call: held 24 h,
   undoable); and a reader host is known only by the `--host codex` launch flag — a hosted, remote or hand-added
   MCP entry treats Codex as the counterpart (map `clientInfo` once measured).
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
