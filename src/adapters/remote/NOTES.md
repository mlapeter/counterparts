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
- **Dreams from a chat (2026-10-26, OL1b).** claude.ai has no console and no dashboard,
  so `recall` reads last night itself: the handle "last dream" (or "last night") returns
  the newest dream whole and the reflection after it, and a dream's id alone now reads
  whole too. A question's answer carries the dreams it reaches, by words and by the
  reflection entry it showed. Dream journals have no embedding, so "by meaning" is words
  for now; a real index would be a cache table, batched with other store-format changes.
- **The first meeting over the door (2026-10-26, OL1b).** It runs cleanly once the store
  starts as a new install (`onboarding.ts#beginNewInstall`); on claude.ai its words say
  a connector, keep no store path or console command, and leave the first dream to the
  routine. Who starts a hosted store as a new install, and with which dreaming setting
  (`auto` means Claude Code's headless run, which claude.ai has not), is the hosted
  server's account-creation step. The meeting's "where it lives" answer is left out on
  the web until the hosted privacy copy exists.
