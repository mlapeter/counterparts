# remote/ — the memory server as a web connector

**Added 2026-10-26** for the claude.ai trial (roadmap C1). A working default, sized for a
one-person trial; the online version (OAuth, accounts, a hosted copy) is later work and
will revise this page.

## Purpose

claude.ai web and mobile reach a tool server only as a *custom connector*: remote MCP over
HTTPS, called from Anthropic's cloud. This module serves the same `McpServer` that
`mcp/bin/serve.ts` serves over stdio, over HTTP instead, so a connector can reach a store
on the owner's machine through a tunnel he starts.

## What it keeps

- **The server, unchanged.** Same tools, same store binding, same refusals. The transport
  (`http.ts`) knows JSON-RPC framing and HTTP and nothing else; no memory rule lives here
  (mcp CONTRACT §5 G8, "wire framing is host trivia").
- **The hookless chat host.** claude.ai is a host of its own (`hosts.ts#CLAUDE_AI_HOST`,
  place `claude-ai:`), decided by this entry point at launch and never by the client's
  name. It reuses Desktop's machinery: `wake` mints the session, calls bind per call, the
  write-up ask rides on a result. The Code-tab path is Desktop's alone.
- **The entry point's guards** (`bin/serve-http.ts`): the store must be named with
  `--dir`, the configuration with `--config`, the explicit-dir guard applies, and the
  owner's live stores (`~/.counterparts`, `~/.bansai`, `~/.claude-engram`) are refused by
  name.

## Guarantees

1. Binds `127.0.0.1` and nothing else (`LOOPBACK`; the bound address is checked after
   `listen`).
2. Answers only under `/<secret>`: 24 random bytes, base64url, fresh per run, compared in
   constant time. Every other path and method gets the same `404` and the same body;
   `GET` and `DELETE` on the secret path get `405` (no SSE stream is offered).
3. The secret appears in one place: the `url …` line on stdout. Not in the call log, the
   process log, stderr, or any error body. (The trial script prints it once and writes it
   to no file; it runs cloudflared with `--loglevel info` pinned, because at `debug` the
   tunnel logs every request URL, per Cloudflare's docs.)
4. One message at a time reaches `handle` (a queue), because `McpServer` keeps per-call
   state on the instance and stdio never delivered two at once. Since OL2 step 1
   (2026-10-26) the POST handling is its own export, `handleMcpPost(req, res, target)`,
   and the queue travels with the server in `target` (`serialQueue()`): the local door
   builds one target, and the hosted server (`hosted/`, design in `docs/hosted/DESIGN.md`)
   keeps one per store behind its own gate. Guarantees 1–3 are the local door's listener
   and are unchanged; the handler knows nothing of any gate. A door may hand in two
   hooks (#659): `gate`, asked once the body is in, and `refusal`, which turns a call's
   error into an HTTP answer for the whole request (the hosted door's 401 for a store
   locked or a token revoked while the call waited). The local door uses neither.
5. Bodies over 1 MB are `413`; a body that is not JSON is `400` with JSON-RPC's parse error; a batch of more than `MAX_BATCH` (32) messages is `400`, refused whole before any message runs.
6. Inbound only: it opens no connection and resolves no host (pinned in
   `test/claude-code.test.ts`).
7. The call log holds ids and codes only: time, method, tool, the connection id
   (`Mcp-Session-Id`, issued at `initialize`), the Counterparts session named or minted,
   ok or the refusal's reason, and at `initialize` the client's name and version.
8. The canary (`--canary`) goes into `initialize`'s `instructions` and into no tool
   description (`test/remote-http.test.ts`).

## What it drops, on purpose, for now

- **Sign-in.** The secret path is the only gate. Anyone holding the URL holds the store,
  for as long as the server runs. OAuth 2.1 (the phone connector's pattern) is the later
  door.
- **Origin / Host checks and CORS.** The tunnel forwards its own hostname and claude.ai
  calls from its cloud, so neither header can be named in advance. DNS rebinding needs the
  path, which no page has; with no CORS headers a browser cannot read an answer. The
  Content-Type is not checked, so a page that knew the path could still send a `text/plain`
  POST with no preflight and be served: the secret is the whole defense (review of #634).
- **SSE and server-to-client messages.** Plain JSON answers only, so a tunnel that does not
  stream can carry it.
- **A console command or package bin.** The door is run by path from the trial script
  (`tools/trials/claude-ai/`). Whether it becomes `counterparts serve --http` waits on
  what the trial shows.
