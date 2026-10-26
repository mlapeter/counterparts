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
