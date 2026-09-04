# Counterparts — install

This is the one canonical install path. `tools/install-loop/run.sh` runs every
command on this page, verbatim, in a throwaway HOME, and fails if a command here
and a command there stop matching — so the page and the machine cannot drift.

Ten minutes, no API key required.

---

## 1. What you need

- **[bun](https://bun.sh) 1.3 or newer.** Counterparts ships as TypeScript
  sources and runs them directly; bun is the runtime. `curl -fsSL https://bun.sh/install | bash`
- **[Claude Code](https://claude.com/claude-code)**, if you want the hooks and
  the MCP tools. The store, the console and the dashboard work without it.
- **No API keys.** Counterparts runs with none; §6 says exactly what you give up.

**Node is not verified.** The core targets built-in `node:sqlite`, which needs
Node 22.5+ behind a flag and 23.4+ by default. Everything on this page was run
under bun 1.3.10 on macOS. Nobody has run Counterparts under Node, so nothing
here claims it works there. There is no build step and no `dist/`; if a Node
target is ever added, it will need one.

---

## 2. Install

Counterparts is not on npm yet. Install from a packed tarball:

```
bun add -g "$PWD/counterparts.tgz"
```

from the directory the tarball is in. The path must be **absolute**: bun 1.3.10
fails a relative tarball path with `ENOENT extracting tarball` (§10).

That puts four executables on your PATH:

| | |
|---|---|
| `counterparts` | the owner's console — status, install, backup, export, removal |
| `counterparts-hook` | the Claude Code hook entry point; one executable, five events |
| `counterparts-mcp` | the MCP server — `note`, `recall`, `status`, `session_end`, `chapter` |
| `counterparts-dashboard` | read-only views of what is in the store |

**From a git clone instead.** `git clone https://github.com/mlapeter/counterparts && cd counterparts && bun install`.
Then every `counterparts …` below becomes `bun run src/adapters/cli/bin/counterparts.ts …`,
`counterparts-hook` becomes `bun run <repo>/src/adapters/claude-code/bin/hook.ts`,
and `counterparts-mcp` becomes `bun run <repo>/src/adapters/mcp/bin/serve.ts`.
Those four paths are stable; the live host has pointed at them since 2026-09-03.

---

## 3. Set it up

```
counterparts install --budget 9000 --name "Your Name"
```

Replace `Your Name` with yours — it is the name your memory's identity is about,
and there is no default. This command writes three things that are **yours**:

```
~/.counterparts/
├── claude-code.json      the adapter's configuration
├── credentials.env       an empty 0600 file for your API keys
└── store/                the memory itself
    ├── prose/            the memories, as Markdown you can read in any editor
    ├── operational.sqlite
    ├── cache/            rebuildable index; losing it costs a re-index
    ├── spans/            lived experience awaiting encoding
    └── sessions/         the live-session registry (see §5)
```

…and it **prints**, without applying, the two things that belong to Claude Code:
the hooks block and the MCP registration. It never opens `~/.claude/settings.json`.

Re-running it is safe: an existing config or credentials file is kept and
reported, never merged and never rewritten. `--force` is the only way past that.

Flags: `--budget <bytes>` (§4), `--name <owner>`, `--embedder` (§6),
`--dir <store>` to put the store somewhere else, `--force`.

### Why the store is `~/.counterparts/store` and not `~/.counterparts`

Because the config has to live **beside** the store, never inside it. The store
classifies every top-level entry of its data directory and refuses to open on one
it does not recognise (`src/core/store/paths.ts`, `LAYOUT` + `assertLayoutClassified`)
— and `claude-code.json` is not one of them. A data dir with the config inside is
a store that will not open.

The store's *default* data dir, when `COUNTERPARTS_DATA_DIR` is unset, is
`~/.counterparts` itself — which is exactly that broken shape. So the config's
`dataDir` points one level down, and `counterparts install` lays it out that way
for you. This is a known bug in the default, worked around here; see §10.

### The `injectionBudgetBytes` number

`--budget 9000` is the number the live host runs on, measured on Claude Code on
2026-09-03: a wake of 8,859 bytes was delivered under it. It is **your host's**
ceiling, not a Counterparts constant, and this package has no default for one
anywhere — a briefing refuses to render rather than compose to a number nobody
chose. Omit `--budget` and the key is left out of the config, the wake is
injected unbounded, and an `adapter.budget.unreported` event says so.

---

## 4. Wire Claude Code

`counterparts install` printed both of these, filled in. They are yours to apply.

**The hooks.** Merge into `~/.claude/settings.json` — one executable, five events:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "counterparts-hook" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "counterparts-hook" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "counterparts-hook" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "counterparts-hook" }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "counterparts-hook" }] }]
  }
}
```

If you already have hooks on those events, add this one beside them — hooks on
one event run in parallel. The hook reads `~/.counterparts/claude-code.json` for
everything else, so it takes no arguments and no environment.

**The MCP server.** Run this once:

```
claude mcp add counterparts -s user -e COUNTERPARTS_DATA_DIR=$HOME/.counterparts/store -- counterparts-mcp
```

`COUNTERPARTS_DATA_DIR` in that line is **not optional**. Claude Code launches MCP
servers from a static configuration with no per-session substitution, so the
server gets no session id and no working directory it can trust; the data dir is
how it finds the same store the hooks are writing. Use an absolute path.

Then **restart Claude Code**. Hooks are read at session start; MCP servers are
launched at session start.

---

## 5. What the pieces do

**The hooks** are the ambient half. `SessionStart` injects the wake — what the
last boundary published, plus a preface naming the system, the day and the
store's size. `UserPromptSubmit` recalls against the turn. `Stop`, `SessionEnd`
and `PreCompact` are boundaries: they capture the conversation into `spans/` and,
at most once in a while, ask you a question through the model. Every hook exits 0
whatever happens — a hook that fails your session is the one failure mode this
adapter does not have.

**The MCP server** is the deliberate half: `note` (remember this), `recall` (ask
memory a question), `status`, `session_end` (write the session's memories),
`chapter` (write the episode).

**`sessions/`** is how those two halves find each other. The hooks know the
session id — the host hands it to every hook — and the MCP server does not. So
the hooks leave a small record at `<dataDir>/sessions/<id>.json` (an id, a scope,
three timestamps, no content) and the server binds to a live one lazily. Deleting
the directory costs a lazy bind and nothing else; it is deliberately not backed
up.

**After an upgrade, restart your sessions.** An MCP server keeps the code it was
launched with for the life of the session. A session open across an upgrade goes
on serving the old server until it restarts.

---

## 6. Keys, and what happens without them

`~/.counterparts/credentials.env` is the one file Counterparts reads keys from,
and only because `claude-code.json`'s `credentialsFile` names it. It exists
because a hook's process environment is not your login shell's: on the live host,
both keys were exported in `~/.zshrc` and neither reached a single hook process.
A value already present in the environment always wins; the file only fills gaps.

Format is `KEY=value` per line (`export KEY=value`, quotes and CRLF tolerated,
`#` comments skipped). Exactly two names are honored; anything else is ignored
and counted. Keep it 0600 — a group- or world-readable file is warned about on
stderr, never refused.

| key | what it buys | without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | the crash-recovery sweep's one model call | the sweep refuses `NO_CREDENTIAL`; a crashed session's captured spans stay uninterpreted. Nothing else changes — this is *not* the ordinary write path. |
| `VOYAGE_API_KEY` | embeddings | recall runs on the lexical channel alone (see below) |

**No embed key is a supported mode, and the code says so, by name.** The semantic
channel is "isolated, and its absence degrades to lexical-only rather than
failing" (`src/core/recall/cues.ts`); the encoder's preselect records
`channelRecord("skipped", "no-chunk-vector")` rather than dropping silently
(`src/core/encode/preselect.ts`); novelty comes back
`{ novelty: null, reason: "no-chunk-vector", blind: true }`
(`src/core/encode/salience.ts`). You get recall — cue-based and temporal — and a
countable record of what you are not getting.

It also says so on the wire. This is the real `recall` result from the install
loop, on a store with no key and no embedder:

```json
{ "path": "question", "reason": "answered", "semantic": "embedder-off",
  "considered": 1, "storeSize": 2, "returned": 1, ... }
```

`"semantic": "embedder-off"` is the whole degradation, named in the answer.

**The embed key alone is not enough.** Embedding means sending memory text to a
third party, so it is a decision, not a capability a stray environment variable
switches on. Add `"embedder": { "enabled": true }` to `claude-code.json`, or pass
`--embedder` to `counterparts install`. Absent, no client is built and no socket
opens whatever keys are lying around.

---

## 7. Check it

```
counterparts status --dir "$HOME/.counterparts/store"
```

A census of what is held, what left, and what was removed. Read-only, and it
opens the store in observer stance so looking at your memory cannot change it.
`Live memories:` counts memories; the `Journal:` line counts episodes, which are
a different thing and do not decay.

```
counterparts-dashboard status --dir "$HOME/.counterparts/store"
```

The same store, rendered. `browse`, `stories` and the other views take `--id`,
`--limit`, `--band`, `--kind`.

To prove the hook works without opening Claude Code, feed it a payload:

```
echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook
```

On a store that has never lived a boundary this prints the honest bootstrap line
— *"No briefing has been composed yet — this store has not lived a boundary."* —
and exits 0. That is the wake path working, with nothing yet to say.

To give it something to say before a first real session:

```
counterparts rebrief --dir "$HOME/.counterparts/store"
```

which re-renders and republishes the wake bundle now, through the boundary's own
renderer, advancing no sleep marker. Run the hook again and you get the bundle.

`COUNTERPARTS_DATA_DIR` does the same job as `--dir` for every command here; the
hooks and the worker read `dataDir` out of `claude-code.json` instead. If you get
tired of typing `--dir`, put `export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"`
in your shell profile. **The console does not read `claude-code.json`'s
`dataDir`** — that file is the hooks' and the MCP server's, not the console's.

---

## 8. Upgrading

```
bun add -g "$PWD/counterparts.tgz"
```

again, from the directory holding the newer tarball — then restart every open
Claude Code session (§5). Your store is untouched:
`counterparts install` never rewrites an existing config or credentials file.

---

## 9. What is actually verified, and what is not

The install loop (`tools/install-loop/run.sh`) runs in a throwaway HOME with no
repo on its PATH and checks, every time:

- the tarball packs, installs globally under bun, and puts four working
  executables on PATH;
- `counterparts install` produces a store that opens, a config beside it, and a
  0600 credentials file, and writes no host configuration;
- the `SessionStart` hook, fed a real payload on stdin, returns a wake block and
  exits 0, and registers the session under `<dataDir>/sessions/`;
- a `note` then `recall` round trip through `counterparts-mcp` over stdio
  JSON-RPC returns the note;
- `rebrief` renders a bundle and the next `SessionStart` injects it;
- the dashboard opens the same store.

**The loop cannot launch Claude Code.** So these are *unverified by it* and only a
real session can settle them: that Claude Code reads the hooks block from
`settings.json` and runs `counterparts-hook` on all five events; that the wake
text actually reaches the model's context; that the Stop ask arrives (it is
delivered on stderr with exit 2, the one channel measured to work on this host);
that `claude mcp add` registers a server the client then launches; and that
`session_end` binds to a live session through the registry. All five are verified
on the owner's machine by the parallel run (`docs/PARALLEL-RUN-STATUS.md`), not
by this loop.

---

## 10. Known rough edges

1. **The default data dir is wrong.** With `COUNTERPARTS_DATA_DIR` unset the store
   resolves to `~/.counterparts`, which is where the config has to live, and a
   config inside the data dir makes the store refuse to open. Every path on this
   page works around it by naming `~/.counterparts/store`. Fixing the default is a
   core change and is proposed, not applied.
2. **The console and the hooks resolve the data dir differently.** `counterparts`
   and `counterparts-dashboard` read `--dir` or `COUNTERPARTS_DATA_DIR`;
   `counterparts-hook` and its worker read `dataDir` from `claude-code.json`;
   `counterparts-mcp` reads `--dir` or `COUNTERPARTS_DATA_DIR`. Three entry
   points, two rules. Give all of them the same absolute path.
3. **`counterparts --help` exits 1.** It prints the usage and returns the usage
   exit code. `counterparts status --help` exits 0.
4. **`bun add -g` needs an absolute tarball path.** On bun 1.3.10,
   `bun add -g ./counterparts.tgz` resolves the package and then fails with
   `error: ENOENT extracting tarball from ./counterparts.tgz`. The same command
   with an absolute path succeeds. Hence `"$PWD/counterparts.tgz"` in §2.
5. **The vector cache stores embeddings as JSON text.** On the owner's migrated
   store that is 177 MB at 13.9K vectors, with a nearest-neighbour scan of
   0.6–1.0 s. Irrelevant to a fresh store; a named debt.
6. **`parallel: { enabled: true }`** appears in the owner's live config. It is the
   parallel-run knob and makes Counterparts stand down unless another file says
   it may speak. Do not copy it.
