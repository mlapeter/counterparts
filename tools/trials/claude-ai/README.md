# claude.ai trial

One day of using Counterparts from claude.ai (web and phone) through a custom connector,
on a fresh trial store, to measure two things docs can't tell us: whether Claude wakes
(calls `wake` at the start of a chat) and whether it remembers as it goes.

- `trial.sh start` makes the trial store (default `~/counterparts-trials/claude-ai`,
  never `~/.counterparts`), starts the memory server over HTTP on 127.0.0.1
  (`src/adapters/remote/`), opens a cloudflared quick tunnel to it, and prints the
  connector URL once. Ctrl-C stops both; the URL dies with them. Needs
  `brew install cloudflared`. `--local` skips the tunnel; `--dry-run` prints what it would run.
- `trial.sh check` starts it locally, checks initialize, tools/list, the canary, a 404 on a
  wrong path and the loopback bind, then stops.
- `trial.sh report` reads the call log (`calls.jsonl`, ids and codes only): per connection,
  whether `wake` came first, and the client name claude.ai sent.
- `trial.sh night <local url>` (optional) runs a night by hand with `claude -p` against the
  running trial server, with hooks, other MCP servers and claude.ai connectors off.
  `trial.sh prompt` prints the night prompt, which is also the Cowork scheduled task's text.

Each start of the same trial directory keeps its store and canary but gets a new URL, so
the connector has to be updated after a restart.

If the quick tunnel misbehaves, Tailscale Funnel is the fallback
(`tailscale funnel <port>`; it needs a Tailscale login). Its hostname is a fixed
`*.ts.net` name, so the Claude Code deny entry in the checklist changes to match it.
