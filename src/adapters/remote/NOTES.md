# remote/ — what the build learned

- **2026-10-26, first build.** `hostOfClient` already maps the client name `claude-ai` to
  Desktop's chat (measured 2026-09-30, Desktop's local MCP client). claude.ai's remote
  client may send the same name, so the host is set by the entry point and `initialize`
  keeps a host the launch chose. The name claude.ai actually sends is recorded in the call
  log's `initialize` line; nobody has seen it yet.
- **One queue in front of `handle`.** Remembers and status calls are synchronous inside, so
  two concurrent requests through the real server never overlapped in testing. A call
  that awaits (recall by meaning, the embedder) would. The test that holds the queue uses
  a deliberately slow stand-in server, because the real one could not show the failure.
- **cloudflared quick tunnels do not carry SSE**, which is why every answer is plain JSON.
  Cloudflare's proxy also ends a response at about 100 s. Counterparts calls take
  milliseconds, so it does not bind today.
- **Claude Code fetches claude.ai connectors** into terminal sessions logged in with a
  claude.ai subscription (this build's own session had `claude.ai Claude Docs` loaded).
  A trial connector would appear there as a second memory server. The trial checklist
  gives the `deniedMcpServers` entry that keeps it out.
- **A night through the tools alone (the roadmap's addendum, 2026-10-26).** A remote model
  (a Cowork scheduled task, or `claude -p` by hand) can run the night with no hooks and no
  local children: `wake` for a session, `dream` `launch` for the prompt, then the tools
  that prompt names (`dream` writer/begin/propose/journal, `self_page`, `recall`,
  `reflect`), all on this door (`test/remote-http.test.ts` holds the names). Two things
  stay with the headless run: the tagging child's `tags` phase (served to that child
  alone), and the transcript catch-up, which has nothing to catch up for a chat with no
  transcript. No tool carries an annotation that asks for a person; `dream` has the
  standard `destructiveHint: true`.
- **The trial store offers no first meeting.** Only `counterparts install` writes
  onboarding `not_started`; a store this door opens fresh reads `done`.
- **claude.ai's surface (2026-10-26, OL1b).** Its wake has its own shape
  (`mcp/chat-wake.ts`): one short session line, what is for the person first (a slot for
  the carried share, the clock and plain reminders, then "Coming up" and "Still open"
  moved up whole), and no dream line — its nights are the person's routine. Its tool
  words describe and never command: the directory's review refuses "call this first",
  so wake-first lives in the person's instruction block. Its one MCP prompt is "Wake
  Counterparts" (the + menu). readOnly stays on Memory status alone (since H1, 2026-10-29,
  not even there: see mcp NOTES "readOnlyHint on a chat's copy"): recall records what
  it delivered (a gate record the credit pass reads) and wake mints a session, so the
  hint would be stretched; the honest route to a read-only recall is one that records
  nothing (an observer read), which is a design change, not an annotation.
- **Dreams from a chat (2026-10-26, OL1b).** claude.ai has no console and no dashboard,
  so `recall` reads last night itself: the handle "last dream" (or "last night") returns
  the newest dream whole and the reflection after it, and a dream's id alone now reads
  whole too, up to what one answer carries (a 30,000-character journal and a 20,000-character
  entry together do not fit: the dream stays whole and the reflection is named, whole by its
  id). A question's answer carries the dreams it reaches: by the reflection entry it showed,
  or, when the question asks about dreams, by words (review of #645: words on every question
  carried a work-week dream beside six of eight ordinary questions). A dream never displaces
  the answer: one that would pass the ceiling stays out. Dream journals have no embedding, so "by meaning" is words
  for now; a real index would be a cache table, batched with other store-format changes.
- **The first meeting over the door (2026-10-26, OL1b).** It runs cleanly once the store
  starts as a new install (`onboarding.ts#beginNewInstall`); on claude.ai its words say
  a connector, keep no store path or console command, and leave the first dream to the
  routine. Who starts a hosted store as a new install, and with which dreaming setting
  (`auto` means Claude Code's headless run, which claude.ai has not), is the hosted
  server's account-creation step. The meeting's "where it lives" answer is left out on
  the web until the hosted privacy copy exists.
- **A connection is not a chat (2026-10-26, OL1b).** claude.ai kept a handful of
  `Mcp-Session-Id`s open across a day of conversations, so the trial's report reads per
  chat: the session `wake` minted, and every later call that named it
  (`call-log.ts#summarizeChats`). Keyed that way "wake first" is true by construction;
  what measures a chat that never woke is the calls that named no session, counted per
  connection, and how many of them came before any wake on it.
- **2026-10-26, OL4: the 7-chat script** (`tools/trials/claude-ai/chat-script.ts`). The
  claude.ai chats Mike drove by hand, played over this door with fixed tool calls and scored
  from the call log and the store; about a second, no model. Learned building it: on this
  hookless host the briefing chat 7 wakes with ("Coming up", "Last night", "Last here") is
  composed only by the worker's sleep. Nothing else here crosses a boundary. With the worker
  stubbed, as every test in this module stubs it, every wake reads the bootstrap line, so the
  script runs the worker's heavy half (`Counterpart.sessionEnd`, as `runner.ts` calls it,
  then its step 3a: `keepHeldPage` and `refreshWake`) in-process after each wake that asks
  for one. Still left out of the runner's run: the vector backfill (no embedder), the
  word-index re-stem (`terms`), the coverage ledger (3b), transcript retention (3c) and the
  snapshot. Review of #652: the night's rows read the store (the dream row `journaled` with
  its words; the link in `dream_changes`, and "Last night" saying so), not the replies; the
  replay asked for is not scored, since a memory born that day is not counted. The script also runs on its own clock
  (the harness's `serve-at.ts` way), so the night falls on the next day and the writer gets
  a day to read; the product has no clock knob. What it can't score, a notice relayed or the
  safety pause, is left to the human run. Thin spot, held lightly: chat 6 chapters a
  one-line chat. A real goodbye closes a longer chat, so the script checks that the chapter
  door works, not what a chapter is like.
