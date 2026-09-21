# Counterparts — install

This is the one canonical install path. `tools/install-loop/run.sh` runs this
page's CONSOLE commands verbatim — each one is grepped out of this file before it
is executed, so a doc edit that changes one fails the loop — in a throwaway home
directory with no copy of this repository on its PATH. It packs the tarball
itself and feeds the hook its own payload. It cannot reach the npm registry, and
it cannot run `git clone`, `claude mcp add`, `export PATH` or Claude Code; §10
lists what that leaves unverified.

No API key required. The scripted version of this page — install, configure,
hook, note, recall, the MCP round trip, the removal plan, the session write and the
scope switch — is
52 checks and runs end to end in two to three seconds; the part that takes you time is
§4, pasting two blocks into Claude Code's own configuration.

---

## 1. What you need

- **[bun](https://bun.sh) 1.3 or newer.** Counterparts ships as TypeScript
  sources and runs them directly; bun is the runtime. `curl -fsSL https://bun.sh/install | bash`
- **npm, only if you install from source** (§2, second half): `npm pack` is how
  you build the tarball from a clone. It comes with Node; a machine set up by the
  bun line above may not have it. (`bun pm pack` exists but is not what §2 was
  tested with, so this page does not tell you to use it.) The ordinary install
  needs bun and nothing else.
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

```
bun add -g counterparts
```

That is the whole install. It copies the package into bun's own global folder;
nothing else on your machine is read or changed, and §3 is where a store gets
made. It puts four executables into bun's global bin directory:

| | |
|---|---|
| `counterparts` | the owner's console — status, install, backup, export, removal |
| `counterparts-hook` | the Claude Code hook entry point; one executable, five events |
| `counterparts-mcp` | the MCP server — `note`, `recall`, `status`, `session_end`, `chapter` |
| `counterparts-dashboard` | read-only views of what is in the store |

**Check that directory is on your PATH before going on:**

```
counterparts --help
```

If that says `command not found`, bun told you so during the install
(`warn: To run "counterparts", add the global bin folder to $PATH`) and the fix is
`export PATH="$HOME/.bun/bin:$PATH"` in your shell profile. A fresh bun install
does not always do this for you.

### Installing from source instead

For contributors, for a version that is not published yet, or for a tarball
somebody sent you. **Already have the repository? Skip the clone and run
`npm pack` there. Were you sent a tarball? Skip to `bun add -g`.** Run the clone
somewhere that does not already hold a directory named `counterparts` — `git
clone` refuses, harmlessly, if one is there.

```
git clone https://github.com/mlapeter/counterparts.git
cd counterparts
npm pack
```

`npm pack` writes `counterparts-<version>.tgz` into the current directory and
prints its name. Install that file, by absolute path:

```
bun add -g "$PWD"/counterparts-*.tgz
```

Two things about that line, both learned the hard way:

- **The path must be absolute.** bun 1.3.10 fails a relative tarball path with
  `error: ENOENT extracting tarball from ./x.tgz`.
- **The same error means "no file by that name."** If you typed a filename that
  does not exist, you get the identical message. Check `ls *.tgz` first.

What lands is the same package the registry serves, in the same place. The clone
is only where the tarball was made: nothing reads it again, and you can delete it.

**Running from the clone instead of installing.** `bun install` in the clone, then
every `counterparts …` below becomes `bun run src/adapters/cli/bin/counterparts.ts …`,
`counterparts-hook` becomes `bun run <repo>/src/adapters/claude-code/bin/hook.ts`,
and `counterparts-mcp` becomes `bun run <repo>/src/adapters/mcp/bin/serve.ts`.
Those four paths are stable; the live host has pointed at them since 2026-09-03.

---

## 3. Set it up

```
counterparts install --budget 9000 --name "Your Name"
```

That is the command you want the first time. Before you run it, one paragraph on
the other one, because the difference is not recoverable by guessing.

### `install` or `init` — which one

```
counterparts init --dir /somewhere/else/store --name "Your Name"
```

`init` makes **just a store**: a data dir, an identity core if you name one, and
a printout of the same install steps. It writes nothing under `~/.counterparts/`,
no configuration and no credentials file, and it touches no host settings.

Use `install` for your first, real memory — it is the cold start, it owns
`~/.counterparts/`, and it is the only one that produces a config the hooks will
read. Use `init` for a second store, a scratch store, or a store on another disk
that you only want to reach from the console and the dashboard. A store made by
`init` has no host wiring at all: the hooks will not see it, because they read one
configuration — the default one, unless something names another (`--config`,
below) — and `init` writes none.

Both take `--name`, and both mean the same thing by it: the identity core is
minted then and there, by the same door, so a store made either way has it as its
first live row. `counterparts status` on a directory with no store points you at
`init`, which is the right answer for the case you are usually in when you see
that message.

### What `install` writes

Replace `Your Name` with yours. It seeds the identity core — the thing the memory
is *about* — and there is no default for it anywhere.

Nothing is composed for you to read at that instant: a fresh store has lived no
boundary, so `SessionStart` prints the honest bootstrap line until one exists
(§7). The first wake that *is* composed — at the end of your first real session,
or right now with `counterparts rebrief` (§7) — opens with your name:

```
Who I am:
This memory is for Your Name. No identity has formed here yet — identity is earned at the boundary that ends a session, from what recurs across distinct days.
```

That is the whole of it on day 0, and it is deliberately the whole of it: the
wake states what the store knows and never invents a first belief about you. The
line stays until an identity element is earned — reinforcement on several
distinct days, decided at a boundary — and disappears the moment one is. Without
`--name` there is no core, and no such line.

This command writes three things that are **yours**:

```
~/.counterparts/
├── claude-code.json      the adapter's configuration
├── credentials.env       0600, holding only comments that name the two keys
└── store/                the memory itself — the default data dir
    ├── counterparts.sqlite   the memories, their prior versions, everything
    └── cache/            rebuildable index; losing it costs a re-index
```

**One file holds your memory.** The bodies, their revision history and every
structured field are rows in `counterparts.sqlite`, so a backup is a file copy
and a memory can never disagree with its own bookkeeping. You read your memories
through the dashboard, `counterparts recall`, or by asking — and
**`counterparts export --out <dir> --markdown --plaintext` writes everything out
as one readable tree of Markdown files** (confidential memories are left out,
and the export says how many; `--include-confidential` takes them too). (SQLite
keeps two sidecars beside it, `-wal` and `-shm`; they belong to the database and
are copied with it.)

**Your journal is already readable, without exporting anything.** Every chapter
the counterpart writes is copied to `store/journal/<year>/<date>-<id>.md` as it
lands — open one in any editor. It is a copy: the database is the original, and
deleting `journal/` loses nothing (the next chapter writes it again, and the
background worker refills anything still missing, a few files per run). Because
it is a copy, **`backup` and the daily snapshot deliberately leave it out** and
a restored store writes the files again from its rows — which also means a
memory you removed does not go on living as plain markdown inside fourteen old
snapshots.

Three more directories appear under `store/` the first time they are needed and
not before: `spans/` (lived experience awaiting encoding, written by the hooks
and by `counterparts note`), `journal/` (the counterpart's diary, also written
as Markdown files as each chapter lands) and `sessions/` (the live-session
registry, §5). A fresh store has none of them, and `counterparts status` lists
them either way.

…and `install` **prints**, without applying, the two things that belong to Claude
Code: the hooks block and the MCP registration. It never opens
`~/.claude/settings.json`.

Re-running it is safe: an existing config or credentials file is kept and
reported, never merged and never rewritten. `--force` is the only way past that.

Flags: `--budget <bytes>` (§4), `--name <owner>`, `--embedder` (§6),
`--dir <store>` (below), `--force`.

### Why the store is `~/.counterparts/store` and the config is one level up

The store classifies every top-level entry of its data directory and refuses to
open on one it does not recognise (`src/core/store/paths.ts`, `LAYOUT` +
`assertLayoutClassified`) — and `claude-code.json` is not one of them. A data dir
with the config inside is a store that will not open.

So the shape is: `~/.counterparts/` holds the configuration and the credentials,
and the store is `~/.counterparts/store` beneath it. That is also the default data
dir, so `COUNTERPARTS_DATA_DIR` and `--dir` are conveniences, not requirements.
`install` writes the resolved `dataDir` into the config anyway — a configuration
that names its store is clearer than one relying on a default.

### `--dir` moves the STORE, and only the store

You can put the memory itself anywhere — another disk, an encrypted volume:

```
counterparts install --budget 9000 --name "Your Name" --dir /Volumes/vault/counterparts-store
```

**The configuration does not follow it.** `~/.counterparts/claude-code.json` is the
path every entry point reads when nothing names another one, so a config written
somewhere else with nothing pointing at it is an ambient half that never fires,
and no hook will tell you: a hook that stands down says so on stderr and exits 0
(§5 has the one exception). The hook falls back to `COUNTERPARTS_DATA_DIR` only
when the config it read names no `dataDir` at all, and `install` always writes
one — so a hand-written config with no `dataDir` is the one shape that can still
land on the default store.

`install` keeps the config where the hooks look, points its `dataDir` at wherever
you sent the store, and says so in its output when you use `--dir`.

The one `--dir` it refuses is `~/.counterparts` itself, which would put the config
inside the data dir. It says so instead of creating a store that will not open.

### `--config` moves the CONFIGURATION — one rule, every entry point

```
counterparts install --budget 9000 --name "Your Name" --config /opt/counterparts/claude-code.json
```

**One sentence, and it is the same for all four entry points:** `--config
<absolute path>` if the command line carries one, else `COUNTERPARTS_CONFIG` if
the environment does, else the default — `~/.counterparts/claude-code.json` for
`counterparts-hook`, its worker and `counterparts-mcp`; for the console, the
config beside the store (`<dir>/../claude-code.json`) and then that same home
path (§7).

The environment variable is the flag's equivalent, for hosts that launch a
process from a static registration and have no command line to write into —
which is exactly how Claude Code launches an MCP server (§4).

A path you named and this cannot use is **refused**, at every entry point that
reads a configuration, and nothing falls back to the default: naming a
configuration is how you say which memory you mean, and quietly using another one
is how a scratch run writes into a live store. Three shapes refuse — a relative
path, an absolute path to a file that is not there, and a file that is not a JSON
object. **The mistyped path is the one that matters**: before 2026-09-05 it was
honoured silently, read as "no configuration", and the store then fell back to
the default one. An absent *default* is still ordinary, because a fresh machine
has none and the hook must still start.

The hook refuses by standing down — one line on stderr, exit 0, nothing injected
— because a hook never fails the host. The MCP server refuses by not starting
(exit 1). `counterparts install` is the exception to all of this: `--config`
names the file it is about to *write*, so a path that does not exist yet is the
ordinary case there.

`--config` on `install` moves the whole base: the configuration goes where you
said, `credentials.env` goes beside it, and the store defaults to `store/`
beneath it (`--dir` still overrides the store). Everything is then printed with
the flag filled in, so the hooks block and the `claude mcp add` line point at the
configuration you chose. Without it, nothing is printed with a flag — the default
path is the rule, and a hooks block that spells it out is one that breaks the day
you move a home directory.

**Every entry point says which file it used.** The console prints it (`rebrief`'s
`budget … from <path>` line, §7); the MCP server and the worker write one line to
stderr at launch; the hook, which has no channel to you — its stdout is the
model's context — records it as the `config` field of
`<dataDir>/sessions/<id>.json`.

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

**The hooks.** Merge into `~/.claude/settings.json` — one script, five events.
`counterparts install` prints this with your own absolute paths filled in; the
shape is:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command",
      "command": "\"/abs/path/to/bun\" run \"/abs/path/to/counterparts/src/adapters/claude-code/bin/hook.ts\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "<the same string>" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "<the same string>" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "<the same string>" }] }],
    "PreCompact":       [{ "hooks": [{ "type": "command", "command": "<the same string>" }] }]
  }
}
```

**Both paths are absolute, and that is not cosmetic.** `counterparts-hook` is a
shim whose first line is `#!/usr/bin/env bun`, so it only runs if bun is on the
PATH of whatever launched it — and a host's process environment is not your login
shell's. This package measured exactly that on day 0 of its parallel run: both
API keys were exported in `~/.zshrc` and neither reached a single hook process.
A `PATH` without `~/.bun/bin` turns every hook into "command not found", which
looks from the outside like a memory that simply never happens.

If you already have hooks on those events, add this one beside them — hooks on
one event run in parallel. The hook reads `~/.counterparts/claude-code.json` for
everything else, so the hooks block passes it no arguments and sets no environment
variable — **that default is the rule** (§3), and `counterparts install` prints
the block without a flag unless you moved the configuration with `--config`, in
which case the same block carries `--config "<your path>"` on every event. (The
hook still reads its own process environment: the two API keys come from there
first, §6, and the store falls back to `COUNTERPARTS_DATA_DIR` if the config it
read names none.)

**The MCP server.** Run the line `counterparts install` printed; its shape is:

```
claude mcp add counterparts -s user -e COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store" -- "/abs/path/to/bun" run "/abs/path/to/counterparts/src/adapters/mcp/bin/serve.ts"
```

**Keep `COUNTERPARTS_DATA_DIR` in that line, and keep it absolute.** It is how the
server finds a store that is not at the default; `install` prints it even for the
default store, because Claude Code launches MCP servers from a static
configuration with no per-session substitution — the server gets no session id and
no working directory it can trust, so the one thing it should not also have to
guess is where the memory is. (Absent it, the server falls back to the same
default the console uses. That is a fallback, not a plan.)

That same static registration is why `COUNTERPARTS_CONFIG` exists: a server
launched from it has no command line you can put `--config` on, so a non-default
configuration travels as a second `-e` — `-e COUNTERPARTS_CONFIG="/your/path"` —
and `counterparts install --config` prints exactly that. The two answer different
questions: `COUNTERPARTS_DATA_DIR` says which store, `COUNTERPARTS_CONFIG` says
whose keys and whose embedder knob (§6, §11.3). The server prints the
configuration it read on stderr at launch, before any protocol.

Then **restart Claude Code**. Hooks are read at session start; MCP servers are
launched at session start.

---

## 5. What the pieces do

**The hooks** are the ambient half. `SessionStart` injects the wake — what the
last boundary published, plus a preface naming the system, the day and the
store's size. `UserPromptSubmit` recalls against the turn. `Stop`, `SessionEnd`
and `PreCompact` are boundaries: they capture the conversation into `spans/` and,
at most once in a while, ask you a question through the model. No hook ever fails
your session — that is the one failure mode this adapter does not have. Every hook
exits 0, with one deliberate exception: a Stop that has a question to ask exits 2
and writes the ask to stderr, because on this host that is the channel the model
actually reads (`hook.ts#hostDelivery`, measured; §10). That 2 is the feedback channel,
not a failure.

**The MCP server** is the deliberate half: `note` (remember this), `recall` (ask
memory a question), `status`, `session_end` (write the session's memories),
`chapter` (write the episode). A chapter of the journal can come back from `recall`
— it is a first-person account and may rightly come to mind — and every result that
is one says so: `journal: true` on the tool's row, `[journal]` in the console, and
`Journal:` in front of the line the hook injects. An account is not a memory.

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
| `ANTHROPIC_API_KEY` | the crash-recovery sweep's one model call | the worker still runs the day — the clock, the flush, the semantic cue, the embedding backfill, the sleep cycle and the briefing — and SKIPS the sweep, writing `sweep.gate` with `reason: "no-credential"` so the skip is on the record. A crashed session's captured spans stay uninterpreted. Nothing else changes — this is *not* the ordinary write path. |
| `VOYAGE_API_KEY` | embeddings | recall runs on the lexical channel alone (see below) |

**No embed key is a supported mode, and the code says so, by name.** An embedding
is an input the caller supplies, and "its absence degrades to lexical-only rather
than failing" — the same sentence, verbatim, in `src/core/recall/cues.ts:26` and
`src/core/recall/index.ts:27`. The encoder's preselect records
`channelRecord("skipped", "no-chunk-vector")` rather than dropping silently
(`src/core/encode/preselect.ts:126`); novelty comes back
`{ novelty: null, reason: "no-chunk-vector", blind: true }`
(`src/core/encode/salience.ts:60`). You get recall — cue-based and temporal — and a
countable record of what you are not getting.

It also says so on the wire. Every `recall` answer carries a `semantic` field
naming how the semantic channel got its input on that ask — this is a real result
from the install loop, on a store with no key and no embedder:

```json
{ "path": "question", "reason": "answered", "semantic": "embedder-off",
  "considered": 2, "consideredCap": 24, "storeSize": 4, "returned": 2, ... }
```

The values, and exactly what each one means
(`src/adapters/mcp/server.ts#embedQuestion`, `deliberate.ts#answerQuestion`):

| `semantic` | meaning |
|---|---|
| `embedder-off` | **no embedder was built**, because `embedder.enabled` is not `true` (or the server stood down as an observer). This is the no-key mode *with the knob off* — the state you are in after a plain `counterparts install`, and the state the console is always in. |
| `embed-failed` | an embedder was built and the call did not return a vector. **This is what a knob turned on with no `VOYAGE_API_KEY` looks like** — the client exists, the call raises `NO_API_KEY`, and lexical answers. Also a network failure or an empty vector. |
| `in-line` | the question WAS embedded and the semantic channel ran. Key present, knob on. |
| `none` | the `handle` and `ids` paths — an exact address does no scoring at all. |

If you have no key and see `in-line`, something is supplying one: the MCP server
reads `~/.counterparts/claude-code.json` for the embedder knob and the credentials
file it names, whatever `--dir` or `COUNTERPARTS_DATA_DIR` say about the store.
That is a real trap — the cold-stranger review of 2026-09-04 hit it, running a
scratch store against an existing config — and it is worth knowing that the store
you point at and the credentials you use are chosen by two different files. The
lever, since 2026-09-05, is `--config` / `COUNTERPARTS_CONFIG` (§3): point the
second file somewhere too, and the server names the file it read on stderr at
launch.

**The embed key alone is not enough.** Embedding means sending memory text to a
third party, so it is a decision, not a capability a stray environment variable
switches on. Add `"embedder": { "enabled": true }` to `claude-code.json`, or pass
`--embedder` to `counterparts install`. Absent, no client is built and no socket
opens whatever keys are lying around.

---

## 7. Check it

`$HOME/.counterparts/store` is the default data dir, so the commands below work
with nothing set. If your store is somewhere else — or you would rather be
explicit than rely on a default — say so once for this shell:

```
export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"
```

Every command in this section takes `--dir <store>` instead if you prefer; the
console and the dashboard read one or the other. The console reads
`claude-code.json` for exactly one thing — `rebrief` without `--budget` takes
`injectionBudgetBytes` from the config named by `--config` /
`COUNTERPARTS_CONFIG` if one was named, else from `<store>/../claude-code.json`,
else from `~/.counterparts/claude-code.json`, and prints which — and never for the
store, the keys or the embedder.

The default can also be **turned off**. In a shell that must never reach
`~/.counterparts` by accident — a scratch store beside a real install, a CI job,
an agent's terminal — export `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`. Then any
command, hook, server or library call that names no store (no `--dir`, no
`COUNTERPARTS_DATA_DIR`) refuses before it opens anything, naming the guard, the
directory it would have opened, and the two ways to name one; the same variable
makes the hook, the worker, the MCP server and `install` refuse an unnamed
configuration, because `~/.counterparts/claude-code.json` names a store too. It
arms on `1`, `true` or `on`, and stands down on `0`, `false` or `off` — case and
surrounding whitespace ignored, blank the same as absent — so `=0` turns it off
rather than tripping it. **Any other value is refused, not read as off**: `=yes`
gets a sentence naming the value, the three words that arm it and the three that
turn it off, because a safety guard that cannot read its own switch fails closed.
Unset — which is every installed host — nothing changes. It is a guard for shells, not
a setting: the store it protects is the one you would have reached without it.

One refusal near that door needs no variable at all, because it answers a real
accident rather than a shape: **`install` will not write the default
`~/.counterparts/claude-code.json` with a `dataDir` under the system temp
directory.** That file is what the hook, the worker and the MCP server read when
nothing names another, so a throwaway store written into it becomes the machine's
live memory until the OS deletes it — which is how three days went unrecorded on
this project's own machine on 2026-09-04. Point a scratch install somewhere of its own instead: `--config
<absolute path outside ~/.counterparts>` moves the configuration, the credentials
and the store together. A clean room whose whole `$HOME` is temporary (the install
loop's, the test suite's) is not this case and is not refused.

### Store some memories and ask for one back

This is the product. Three commands, no host, no keys:

```
counterparts note "The espresso machine in the kitchen is a Rancilio Silvia."
counterparts note "Postgres in dev listens on port 5433, not 5432."
counterparts recall "which port does postgres use in dev?"
```

`note` prints the store it wrote to, then `Remembered mem_… — minted.` `recall`
prints the same `Store:` line first, then a header line, the memories it found,
and what the tier on each one means:

```
Store: /Users/<you>/.counterparts/store
question · answered · semantic embedder-off · considered 1 of 3 live rows · returned 1

  mem_30fbdaa753c5  [quiet] fact
    Postgres in dev listens on port 5433, not 5432.

  quiet = quietly available; the ambient path would have footnoted it, not said it
  Nothing here came back vividly, so treat these as leads rather than answers.
```

(A real capture, on a store made the way §3 says — `--name`, either door — and
then those two notes. **Three** live rows for two memories: the identity core
`--name` seeded is the third, because `live rows` counts every unarchived row and
not only the memories. That is why this number and the wake preface's
`N memories` are two different numbers about one store, and `counterparts status`
prints the split. One question, one answer out of two candidate memories: that is
recall discriminating, not a store too small to have a choice.)

These are the same two doors the MCP tools use — `note` captures the words into
the span buffer and then deposits a draft that claims that span by hash; `recall`
calls the same deliberate-recall dispatcher — so what you see here is what Claude
Code will see. `--kind`, `--title` and `--salience` shape a note; `--id <mem_…>`
asks for one memory in full instead of asking a question; `--json` prints the
tool's own payload.

**Read the tier, not the word `answered`.** `answered` means the question reached
something; it is not a claim that the something is right. The tiers are the only
confidence signal in the output, and the line under the results says what the
ones you got mean. Asked something this store genuinely does not know — *"what
colour is the sky on Mars?"* — the same store returns the espresso machine at
`[quiet]`, with the same "treat these as leads" line (captured, same run). A cue-based
channel with no embedder answers with the nearest thing it has; a `[quiet]` or
`[dim]` result is the system saying *this is what I would have murmured*, not
*this is your answer*.

It also works on the very first memory: a store holding one memory answers the
question about it. On the store §3 makes that reads `considered 1 of 2 live rows`
— the memory, and the identity core beside it; on a store made by a bare `init`,
with no `--name` and so no core, `1 of 1`. The install loop checks the bare case
on every run, because it is the first thing anyone does and it is invisible to
any test that seeds two rows.

### Look at the store

```
counterparts status --dir "$HOME/.counterparts/store"
```

A census of what is held, what left, and what was removed. Read-only, and it
opens the store in observer stance so looking at your memory cannot change it.

The first line names four populations because they are four different things,
and adding them together is how one store came to report three different sizes:
**`Memories:`** is what the AI learned, and it is the number the wake preface
states back to the model at every session start; **`Beliefs and entities:`** is
what it believes about people and things, which decay and are revised under their
own rules; **`Journal:`** is episodes, the source a memory was made from, which
never decay; **`Archived:`** and **`Superseded:`** are what has left. The `by
kind` and `by band` lines below are over memories and beliefs together, and the
band is computed from each row's physics today rather than read from the column
it was born with — which is why it matches the dashboard's.

Under them, two lines of the day's own facts: how many memories were born today,
what lived day the store is on, when it was last active, when the last boundary
was, whether a self page has been written, how old the newest snapshot is, and
which journal mode the database is in. `counterparts doctor` grades all of that;
this command only counts it.

`--layout` adds a block naming the directories the store keeps and which of them
a backup carries. It is written for whoever maintains a store rather than for
whoever owns one, which is why it is behind a flag.

```
counterparts-dashboard status --dir "$HOME/.counterparts/store"
```

The same store, rendered. `browse`, `stories` and the other views take `--id`,
`--limit`, `--band`, `--kind`.

Pointed with `--dir` at a directory with no store in it, both consoles say `No
store at <dir>. Run 'counterparts init --dir <dir>' to create one.` and exit 1 — a
census of nothing at all is not a success, and a script wrapping `counterparts
status` should hear about a mistyped `--dir` rather than sail past it. Neither
one creates the store by looking for it.

Every command has its own help: `counterparts <command> --help` prints what
that command does and every flag it takes, and opens nothing.

### Remove a memory, and read what removal does not reach

```
counterparts remove mem_b77c9e0e9808 --dir "$HOME/.counterparts/store"
```

**A dry run by default.** It prints the plan — every surface it would chase, with
counts; the ids (never the text) of other memories whose words overlap; and one
line for the raw capture buffer — then says `Dry run. Nothing has changed.`
Add `--confirm` to do it, and the command asks you to type the id back before
anything moves. There is no `--force`: removal is the one owner operation with a
human in the loop.

Read the `spans` line before you confirm. On a memory that was taken as a note it
says this — one line in the terminal, wrapped here:

```
  chase spans: 1
  chased — spans/be4b7f492c17/jots.jsonl — the raw capture buffer holds this
  memory's words (matched by the span hash its mint recorded);
  the removal strikes them out of it.
```

The parenthesis is not decoration. There are two ways this command can find your
words, and they are not equally strong: `matched by the span hash its mint
recorded` is identity, and `matched by content` is a jot whose whole text is this
memory's body. Read which one you are about to run before you confirm.

That directory name is a 12-hex key derived from the project the note was taken
in, not the project's path; the command prints your real one.

A note is captured verbatim into the span buffer before it is minted, and until
2026-09-05 `remove` reached the database, the links and the cache but
not that file — so a removed note's words survived there, and a backup taken
afterwards copied them. They do not now: the buffer is a chased surface like
every other. The line the doomed span rode on is rewritten out of every file that
held it (the live streams, any claim a worker is mid-arc on, the quarantine), its
hash is kept in the buffer's own `consumed.jsonl` so nothing re-captures the same
words, and the id goes dark on the deny-list so nothing can quietly resurrect the
memory. Take a backup afterwards and grep it: the note's own capture is gone.

**What it deliberately does not take, and says so.** If you asked for the note in
conversation, the turn you said it in is also in the buffer — a conversation span
is many turns joined together, it belongs to no single memory, and striking it
because one memory quotes it would destroy material you never named. So it is
left, on its own line, which is neither `chased` nor `unchased`:

```
  LEFT on purpose — spans echo: 1 line of conversation quoting these words —
  transcript, not this memory's capture. Left on purpose. Nothing prunes the
  buffer today, so it stays there.
```

Read that last clause literally. **Nothing prunes `buffer.jsonl` for a session
that ended normally** — the crash-fallback sweep only claims sessions that went
silent without a session-end boundary — so a conversation turn quoting a removed
memory stays on disk indefinitely, and a `grep` of the whole store will keep
answering. The memory is gone; the transcript of having said it is not, and
nothing today will take it. (Filed as `src/core/remember/INTERFACE-GAPS.md` §10.)

**The one chase this command refuses to make on its own.** A memory whose
provenance recorded no scope — every row the owner's one-off v1 import wrote
looked like this — can only be found in the buffer by matching its text, and
matching text with no scope means visiting every project on the machine. So it
does not. It tells you what it would have matched, by file and count, and stops:

```
  NOT chased — spans/ — this memory's provenance records no scope and no span
  hash, so a chase by content would have to visit EVERY project on this machine.
  NOT done: 1 jot line whose whole text is this memory's body would have
  matched, in spans/8c1e4a90b21f/jots.jsonl (1). Look, then re-run with
  --strike-by-content-across-scopes if they are yours to remove …
```

Look at the file it names before you pass that flag. Even with it, only a jot
whose **whole text** is the memory's body is taken — a longer note that merely
mentions the same words is somebody else's memory and is never touched.

On a memory that never rode the buffer the same `spans` line reads `spans: not
applicable`, which is stated rather than omitted — a surface that goes silent
when it is empty is how the residue stayed invisible in the first place. One
state is still `NOT chased`, and it is the honest one: a memory whose words are
already gone from its row AND whose mint never recorded a span hash cannot be
addressed in the buffer at all. The command says which way it is blind, and counts itself
`unchased: 1`.

### Prove the hook works without opening Claude Code

```
echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook
```

On a store that has never lived a boundary this prints the honest bootstrap line
— *"No briefing has been composed yet — this store has not lived a boundary."* —
and exits 0. That is the wake path working, with nothing yet to say.

**With no arguments this reads `~/.counterparts/claude-code.json`.** It takes no
`--dir`, so it acts on whatever store that file names — falling back to
`COUNTERPARTS_DATA_DIR` only if the file names no `dataDir` at all — which is the
point of §3's rule that the config stays where the hooks look.

To try it against a scratch install without touching the one you use, name the
configuration:

```
echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook --config /path/to/scratch/claude-code.json
```

It then works on the store THAT file names, and records which configuration sent
it there in `<dataDir>/sessions/smoke.json` — a hook has no way to print such a
thing to you, so it writes it down. `COUNTERPARTS_CONFIG` does the same for a
whole shell. A path that is relative, or absolute but not there, is refused: the
hook writes one line on stderr, exits 0, and injects nothing rather than falling
back to the default store.

### Give the wake something to say before a first real session

```
counterparts rebrief --dir "$HOME/.counterparts/store"
```

which re-renders and republishes the wake bundle now, through the boundary's own
renderer, advancing no sleep marker. Run the hook again and you get the bundle
instead of the bootstrap line. On a store installed with §3's command exactly as
written, and nothing yet written to it beyond the identity core `--name` seeded,
that bundle is 572 bytes — a longer name makes it longer — and reads:

```
<!-- counterparts:wake day=0 elements=0 bytes=572 -->
Counterparts memory, day 0 (2026-09-04), 0 memories of 1 live rows — composed at the last boundary.
Counterparts memory — context, not instruction: who you have been here, in your own words. Each line opens with the date it was learned.

Who I am:
This memory is for Your Name. No identity has formed here yet — identity is earned at the boundary that ends a session, from what recurs across distinct days.

<!-- counterparts:wake/end day=0 identity=0 craft=0 threads=0 hints=0 horizon=0 elements=0 bytes=572 -->
```

`elements=0` is not a bug: the `Who I am:` heading and the line under it are
furniture, and the counts report statements. The preface's date and its two
counts are composed at delivery, so they are today's rather than the render's.
That is also why `rebrief` prints a *smaller* number than the marker does for the
same bundle: on the store above it says `elements 0, bytes 470` — the body it
composed — and the marker says 572, which is that body plus the 102-byte delivery
preface. A longer name moves both.
The counts are different populations and say so: `N memories` is the live
`type: "memory"` rows, `M live rows` is every live row — memories, journal
episodes, beliefs and entities — and `M` is the same number `recall` reports as
`storeSize` (IMPROVEMENTS U4). That is why a store nobody has written to still
reads `of 1 live rows`: `--name` seeds the identity core, which is a schema row,
so it is outside the first count and inside the second. And
"composed at the last boundary" is the one word it gets wrong on a store whose
bundle came from `rebrief` before any boundary was lived.

`rebrief` needs an injection ceiling and will not invent one. It takes it from
`--budget <bytes>` if you pass one; otherwise from the config you named with
`--config` / `COUNTERPARTS_CONFIG`, and only that one; otherwise from
`<store>/../claude-code.json`; otherwise from `~/.counterparts/claude-code.json`,
which is where the hooks read. **It always prints which**, as `budget 9000 bytes
from <path>` (with `(named by --config)` when you named it) — a ceiling taken out
of a file you did not name should never be silent — and if nothing answers, it
refuses and lists every path it tried.

To recap the two questions and their two answers. **Which store**: the console and
the dashboard take `--dir` or `COUNTERPARTS_DATA_DIR` — with one exception, the
console's bulk repairs (`migrate-cache --apply`, `repair-dates --apply`,
`backfill-claims --apply`, `repair-merged-beliefs --apply`, and `verify` with
`--rebuild`, `--prune-index`, `--retry-skipped` or `--drop-vectors`), which rewrite a whole store at
once and take `--dir` alone, refusing a store named only by the variable; the MCP server takes
`--dir` or `COUNTERPARTS_DATA_DIR`; the hook and its worker take neither and use
the `dataDir` in the configuration they read, falling back to
`COUNTERPARTS_DATA_DIR` only if it names no store. **Which configuration**: one
rule for all four — `--config <absolute path>`, else `COUNTERPARTS_CONFIG`, else
the default (`~/.counterparts/claude-code.json`; for the console,
`<dir>/../claude-code.json` first). The console reads that file only for
`rebrief`'s ceiling; the store, the keys and the embedder knob in it are the
hooks' and the MCP server's.

---

## 8. Which directories it remembers

The hooks are registered once, globally, so a session in ANY directory is
remembered by default. `counterparts scope` is where you say otherwise, one
directory at a time. It writes the host's own registry — `scopes.json`, beside
`claude-code.json`, so `--config` moves the two together — and it opens no
store: it takes no `--dir` and works on a machine that has none yet.

From inside the directory you mean:

```
counterparts scope . --off
```

and nothing there is recorded or read again: the hooks produce no output and
write nothing at all, and every MCP tool refuses by name (`scope-off`). The
other three modes:

- `--on` — the default: capture, deposit, wake and recall, as everywhere else.
- `--observer` — reads only. The wake and recall are delivered; nothing is
  captured or deposited, and `note`, `session_end` and `chapter` stand down.
  This is the same stance §6's observer configuration produces, said in one word.
- `--pause` — off for now, remembering what to go back to.

`--resume` undoes a pause, and turns an `--off` directory back on:

```
counterparts scope . --resume
```

To see what one directory resolves to and which entry decided it — a
subdirectory inherits its nearest ancestor, so turning a project off turns off
every worktree under it:

```
counterparts scope .
```

and for the whole registry, with the file it came from:

```
counterparts scope --list
```

Two more things worth knowing. **Nothing set means on**: a directory nobody has
answered for behaves exactly as it did before any of this existed — which is why
the first session in an unset directory asks you, once, which of the three you
want, and records your answer with the command above. And `--note "<text>"`
keeps the reason beside the entry, for the version of you that reads the list in
six months.

---

## 9. Upgrading

```
bun add -g counterparts@latest
```

(From source: `git pull && npm pack` in the clone, then the tarball line from §2.)

Then restart every open Claude Code session (§5). Your store is untouched:
`counterparts install` never rewrites an existing config or credentials file.

---

## 9a. Starting over

You may want a blank memory — to see what a new user sees, or because the first
few days of a store are mostly you learning what it does. One command:

```
counterparts start-fresh --config ~/.counterparts/claude-code.json
```

**Close every Claude Code session and every dashboard first.** A running session's
hooks and its MCP server hold the store open by a file handle, and a handle does
not follow a rename — until they restart, they go on writing into the directory
that was just parked. **Nothing in the command can check this for you**: a session
sitting idle writes nothing, so it leaves no record and no timestamp. What you can
do, in another terminal:

```
pgrep -fl counterparts
```

Look for lines running one of **ours**: `serve.ts` (an MCP server), `dashboard.ts`,
`hook.ts`, `runner.ts` (the worker). Each of those is holding the store open.
**Ignore anything that merely has the word in a path** — `pgrep -f` matches the
whole command line, so an editor, a `tail`, a dev server in a directory with this
name in it will all show up and none of them matters. This command will be in the
list too, while it waits for you.

A dashboard and an MCP server leave **no live-session record at all**, so the
command cannot see them however hard it looks. That is why it asks you to type the
name, and why `--yes` on a store with anything in it is refused unless you also
pass `--nothing-is-open` — which is you saying the sentence `--yes` does not.

**Run it from a plain terminal, not from inside Claude Code.** Your own session's
record is one the check refuses on, so it will turn you away — correctly — and you
will have closed the session anyway by the time you can answer.

The command asks you to type the parked directory's name back before it does
anything.

What it does, in order:

1. Renames `~/.counterparts/snapshots` to `snapshots.parked-<today>`, and then
   `~/.counterparts/store` to `store.parked-<today>` (with a shared `-2` if you
   have done this already today — both directories always wear the same suffix). **One atomic rename each. It never copies, never
   deletes, and never opens the old store — not even read-only.**
2. Creates a blank store back at `~/.counterparts/store`, by running `install`.
   It builds it **beside** your memory first and moves it into place with one
   rename, so there is never a stretch where the configuration points at nothing
   and a stray hook could mint a store there.
3. Leaves `claude-code.json`, `credentials.env` and `scopes.json` exactly as they
   were, byte for byte. Your keys, your ceiling and your per-directory settings are
   host wiring, not memory — and leaving `scopes.json` alone is the point: a
   directory you turned **off** stays off on the new store, rather than quietly
   starting to record again.

The date in the parked name is **UTC**, like every other date this system writes,
so an evening run west of Greenwich parks under tomorrow's date. It is a label,
not a claim about your clock.

Then **restart Claude Code**. There is almost certainly nothing to re-register: if
you registered the MCP server the way `install` prints it
(`-e COUNTERPARTS_DATA_DIR=<your store>`), that path has not moved and the blank
store is sitting at it. The command cannot read your host's files to check — it
never touches them — so if you want to be sure, `claude mcp get counterparts` says
what it was actually registered with.

**`--dry-run` prints every rename and every file it would write and changes
nothing.** Run that first if you want to see it.

**Going back is one command:**

```
counterparts start-fresh --undo
```

It parks the blank store, puts your memory back, puts the snapshots back — one
rename each, nothing deleted, nothing opened, and it refuses rather than moving
one directory inside another. It runs **exactly the same refusals as the forward
direction** — the same forbidden roots, the same symlink and absolute-path rules,
the same live-session check, the same `--yes` rule — and it will not act on a
recorded path that is not a parked directory of this store, because that record
is a row in a database. Restart Claude Code again afterwards.

There is **no undo of an undo**: the store it displaces is parked under a
`blank-<date>` name, which nothing reads as a parked store. A successful undo
prints the two guarded lines that bring that one back.

The same three moves are also **printed as shell lines**, before anything moves
and again afterwards, so the way back is on your screen even if this is
interrupted. Each printed line is guarded:

```
if [ -e "<destination>" ]; then echo "REFUSING: … already exists" >&2; false; else mv "<source>" "<destination>"; fi
```

That guard is not decoration. A bare `mv a b` where `b` is an existing directory
does not refuse and does not overwrite — it moves `a` **inside** `b`, and reports
success. The refusal exits non-zero, so a pasted block stops rather than carrying
on past it. The blank store is *parked* by the first line, not removed: nothing in
this command deletes anything, including an undo.

Two more things it will not do:

- It refuses `--dir`. The store it parks is the one your **configuration** names,
  because that is the one your hooks and your MCP server open; a second answer on
  the command line is how the wrong store would get moved. Use `--config` to name
  a different configuration.
- It refuses by name to touch anything under `~/.bansai` or `~/.claude-engram`.
- It parks the snapshots folder only when that folder is the one this layout owns
  (`~/.counterparts/snapshots`). A `snapshots.dir` or `snapshots.mirror` you pointed
  somewhere of your own is **left alone** — it is your directory — and the command
  says so. The new store's rotation then shares that folder with whatever is already
  in it: copies of a store on the old floor are recognised there and never deleted
  or counted, but copies this floor wrote do count toward `keep`, so the new store's
  oldest copy could rotate out sooner than you expect.

**On cut-over day, deploy first.** If you are moving from an older build, update
the checkout *before* you run this, not after: the older build does not have this
command at all, and in the gap between a fresh start and a deploy any session that
starts would run the old build against the new store and write half a memory into
each of them. The new build's hooks stand down cleanly and harmlessly against an
old store, so deploy-first costs nothing. Close everything, back up with the old
build (the new one cannot open an old store), deploy, then run this.

If the store being parked was written **before this build's floor** — that same
case — the command says so, names the files it recognised, and carries on. It has nothing to open, so the
floor is not its problem: a rename does not care what is inside a directory. That
is also why the store you park stays readable by the build that wrote it
(`floor/v5-last`), exactly as it was.

`counterparts status` on the new store will say what day it began on and where the
previous one is parked.

---

## 10. What is actually verified, and what is not

The install loop (`tools/install-loop/run.sh`) runs in a throwaway HOME with no
repo on its PATH and checks, every time:

- `npm pack` produces a tarball, and it carries every relative file this page and
  the README link to — no dead links inside the package;
- the tarball installs globally under bun and puts four working executables on
  PATH, and the package's own `exports` map imports;
- `counterparts install` produces a store that opens, a config at
  `~/.counterparts/claude-code.json`, and a 0600 credentials file, and writes no
  host configuration;
- the printed hook command runs on a PATH with **no bun on it** — the one failure
  a real host is likeliest to hit and the rest of the loop is blind to;
- the `SessionStart` hook, fed a real payload on stdin, returns a wake block and
  exits 0, and registers the session under `<dataDir>/sessions/`;
- `counterparts note` then `counterparts recall` round-trips on the console, and
  a `note` then `recall` round trip through `counterparts-mcp` over stdio
  JSON-RPC returns the note;
- **and the one-memory case** (§7): one note in a fresh store, recalled by
  question, comes back. It is its own step because a bug at store size one is
  invisible to every check that seeds two rows — which is how one survived to a
  stranger's first minute on 2026-09-04;
- a `session_end` through a separate `counterparts-mcp` process **binds lazily** to
  the session the hook registered, and mints the memory — the deliberate write
  path a real session uses, without a real session;
- the **one config rule** (§3) at the two entry points that could not be checked
  before it existed: `counterparts-hook --config <a second config>` works on the
  store that file names, records it in the session file, and leaves the default
  store untouched; `COUNTERPARTS_CONFIG` launches `counterparts-mcp` on a named
  configuration; and a path that is named but unusable — relative, or absolute and
  not there — refuses at both, the hook by standing down at exit 0, the server by
  not starting;
- `rebrief` names the file its injection ceiling came from, falls back to the
  hooks' config for a store that has none beside it, and refuses — listing every
  path it tried — when nothing supplies one;
- `rebrief` renders a bundle and the next `SessionStart` injects it;
- the dashboard opens the same store.

**The loop cannot reach the npm registry.** It installs the tarball it packed,
from disk. `bun add -g counterparts` (§2) and `bun add -g counterparts@latest`
(§9) deliver that same package by another road, and that road is *unverified by
the loop*: only a real machine with a network can settle it.

**The loop cannot launch Claude Code.** So these are *unverified by it* and only a
real session can settle them: that Claude Code reads the hooks block from
`settings.json` and runs `counterparts-hook` on all five events; that the wake
text actually reaches the model's context; that the Stop ask arrives (it is
delivered on stderr with exit 2, the one channel measured to work on this host);
and that `claude mcp add` registers a server the client then launches. **All four**
are verified on the owner's machine by the parallel run
([`docs/PARALLEL-RUN-STATUS.md`](https://github.com/mlapeter/counterparts/blob/master/docs/PARALLEL-RUN-STATUS.md),
in the repository), not by this loop.

The fifth host behaviour — `session_end` binding to a live session **through the
registry**, since the server is never told a session id — the loop now does
exercise, end to end: the hook writes `sessions/<id>.json`, a separate
`counterparts-mcp` process is given only the data dir and the scope, and its
`session_end` binds to that record and mints the memory (loop step 34; the
refusals `session-unknown`, `scope-mismatch` and `session-required` are what the
step fails on). What is still unverified is the same thing as above: that this
happens inside a real Claude Code session, where the id comes from the host
rather than from a script.

---

## 11. Known rough edges

1. **Four entry points, two questions — and two deliberate exceptions.** WHICH
   STORE: `counterparts` and `counterparts-dashboard`'s **views** read `--dir` or
   `COUNTERPARTS_DATA_DIR`; `counterparts-mcp` reads `--dir` or
   `COUNTERPARTS_DATA_DIR`; `counterparts-hook` and its worker take neither and
   use the `dataDir` in the configuration they read, falling back to
   `COUNTERPARTS_DATA_DIR` only when it names no store. The first exception is
   the console's BULK REPAIRS — `migrate-cache --apply`, `repair-dates --apply`,
   `backfill-claims --apply`, `repair-merged-beliefs --apply`, and `verify` with
   `--rebuild`, `--prune-index`, `--retry-skipped` or `--drop-vectors`. Each rewrites a whole store
   in one go, so each takes `--dir` and **refuses** a store named only by the
   variable: an exported path is a shell's memory of where a store lives, not a
   sentence you typed about this rewrite. `--yes`, where a command has one, skips
   the typed confirmation and never stands in for `--dir`. The dry runs — every
   one of these without its writing flag — read the variable as usual. The second
   is `counterparts-dashboard serve`: it takes `--dir` and **refuses** to take the
   store from `COUNTERPARTS_DATA_DIR` alone, because §7 tells you to export that
   variable with the live store's path in it and `serve` puts a whole memory on a
   socket in a browser — that choice is made in the command or not at all.
   `--default-store` means the default (and reads the variable) if you want it.
   WHICH CONFIGURATION: one rule for all four — `--config <absolute path>`, else
   `COUNTERPARTS_CONFIG`, else the default. The asymmetry that is left is the
   hook's: it is the one entry point with no `--dir`, so pointing it at another
   store means pointing it at another configuration (§3, §7). Both defaults can
   be refused wholesale with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` (§7): with it
   set, an unnamed store or an unnamed configuration is a refusal, not a fallback
   — the one exception being `rebrief`'s ceiling, a number read from the default
   config for a store you already named, which stays readable.
2. **`bun add -g` needs an absolute tarball path — and the same error means "no
   such file".** On bun 1.3.10 a relative path fails with
   `error: ENOENT extracting tarball from ./x.tgz`, and so does an absolute path
   naming a file that does not exist. Check `ls *.tgz`. Hence
   `"$PWD"/counterparts-*.tgz` in §2.
3. **The store you point at and the host settings you get come from two different
   files** — and you now have to move both. `--dir` / `COUNTERPARTS_DATA_DIR`
   choose the store; the configuration supplies host settings — the embedder knob
   and the credentials file for the MCP server and the hooks, and, as a last
   resort, the injection ceiling for `counterparts rebrief` (§7). Running a
   scratch store on a machine that already has a configured install will use that
   install's keys unless you also pass `--config` / `COUNTERPARTS_CONFIG` (§3),
   and can compose a briefing under that install's ceiling. §6 says how to tell
   from the `semantic` field; `rebrief` names the file it read, and the server
   names it on stderr at launch.
4. **The vector cache stores embeddings as JSON text.** On the owner's migrated
   store that is 177 MB at 13.9K vectors, with a nearest-neighbour scan of
   0.6–1.0 s. Irrelevant to a fresh store; a named debt.
5. **`parallel: { enabled: true }`** appears in the owner's live config. It is the
   parallel-run knob and makes Counterparts stand down unless another file says
   it may speak. Do not copy it.
6. **Removal reaches the span buffer — with two things it names rather than
   takes.** A note is captured verbatim into `spans/<12-hex key>/jots.jsonl`
   before it is minted. Until 2026-09-05 `remove` chased the database,
   the links and the cache and not that file, so a removed note's words survived
   there and a backup taken afterwards copied them. The buffer is chased now
   (§7). **Check it in three lines** — the marker text is only there so `grep`
   has something to find:

   ```
   counterparts note "ZQPROBE the culvert gate key is under the third fence post." --dir "$HOME/.counterparts/store"
   counterparts remove <the mem_… it printed> --confirm --dir "$HOME/.counterparts/store"
   grep -rl ZQPROBE "$HOME/.counterparts/store"
   ```

   Nothing answers. Run the same three lines with the note taken through the MCP
   tool mid-conversation and one file can still answer — `buffer.jsonl`, holding
   the turn in which you SAID it. That is transcript, not the memory, and it is
   left on purpose; `remove` counts it on a `spans echo` line rather than
   passing over it. The other thing it names: a memory whose words are already
   gone from its row AND whose mint recorded no span hash — an old row, or one
   edited in the database by hand — cannot be addressed in the buffer at all, and
   `remove` says which way it is blind on its `NOT chased` line and counts it
   `unchased: 1` rather than reporting `nothing`.
7. **The package ships the modules' own `CONTRACT.md`, `NOTES.md` and
   `INTERFACE-GAPS.md`** — 40 files, 0.45 MB, in a 2.2 MB package (measured
   2026-09-04 on `npm pack --dry-run`, 742.2 kB packed over 168 files, plus the
   tarball's own listing; the TypeScript sources are the bulk of the rest, and
   the Markdown grows as the modules record what they learned). Deliberate: those files are what
   `src/` is documented by, and this page points at them. Delete `src/**/*.md`
   from your install if you would rather not carry them.
8. **A configuration the hooks cannot read is a silent session with no memory.**
   A named configuration that is missing, unreadable or not JSON is refused (§3),
   and the refusal happens before anything opens, so a stood-down hook leaves no
   ring event, no session record, nothing durable — the right choice (it will not
   write into a store it was not told about) with an unhelpful symptom: nothing
   happens, and nothing says why. Two lines diagnose it:

   ```
   echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook
   env | grep COUNTERPARTS_CONFIG
   ```

   The first prints the stand-down reason on stderr; the second finds a stale
   `COUNTERPARTS_CONFIG` exported into the environment Claude Code was launched
   from, which is the likeliest cause and the hardest to see.

---

## 12. If the terminal says something at session start

Claude Code prints one line of its own when a session starts and Counterparts has
found something RED. **On a fresh install there is nothing red, so there is no
line** — a store that has never had an API key is a supported way to run (§6),
and as of 2026-09-20 `doctor` grades that amber rather than red. The example
below is a store that HAD a key and lost it, which is the case the notice was
built for:

```
SessionStart:startup says: counterparts: Credentials — …/credentials.env holds no key:
ANTHROPIC_API_KEY is missing, so the worker will run without an interpreter; nothing is
encoded. Run: counterparts credentials set ANTHROPIC_API_KEY …
run: counterparts doctor
```

It is not an error and it blocks nothing: the wake still goes out on the same
turn, unchanged. **Red only** — the notice fires for the things that mean part of
the system is not running, never for the merely imperfect. Nothing red, and the
hook prints exactly what it always printed.

This exists because of a week in September 2026 when it did not. The credentials
file had been rewritten to its template by a forced install; every detached
worker was refused at every boundary; the lived-day clock froze, no sleep cycle
ran, nothing was embedded, and every ask was capped against a day that never
rolled over. Every visible surface — the wake, recall, capture, `verify`, the
daily record — read healthy the whole time.

### `counterparts doctor`

The same reading, in full, on demand, and read-only. It opens the store in
observer stance, writes nothing, and never prints a credential value:

```
counterparts doctor
counterparts doctor --json          # the findings as JSON: ids, counts, severities
```

Worst first, one line of facts and one line naming the fix. Exit code **1** if
anything is red, 0 otherwise, so a script can branch on `$?`. What it reads:

| finding | red when |
|---|---|
| Config | the file the hooks read is missing or will not parse |
| Store | there is no store where the config points |
| Embedder | — (amber when `embedder.enabled` is not literally `true`) |
| Stance | — (amber under `observer`) |
| Credentials | `ANTHROPIC_API_KEY` is absent from the file (amber for the embed key, or a mode that is not 0600) |
| Checkout | the checkout the hooks run is not an ancestor of `origin/master`, or has tracked modifications (amber when it is merely behind) |
| Clock | — (amber when `lastActiveDate` is older than the newest boundary: sessions are ending and the worker is not running) |
| Sweep / Sleep / Backfill / Credit | the newest `sleep.cycle` did not run, or the backfill embedded nothing twice running |
| Spawn | the worker has been refused as many times in a row as the escalation threshold |
| Vectors | — (amber while live memories have no vector) |

Two things it does differently from every other command, and both matter. It
reads the store the **configuration** names (`--dir` overrides it), because the
question is whether the store the hooks open is healthy. And it reads the
credentials from the **file**, against an empty environment — a doctor that
counted your own shell would read green on a machine whose `~/.zshrc` exports
both keys while every hook process, which inherits neither, stayed blind.

### `counterparts credentials set <NAME>`

The repair, in one command, with the value never touching your shell history:

```
printf '%s' "$KEY" | counterparts credentials set ANTHROPIC_API_KEY
counterparts credentials set VOYAGE_API_KEY --from-env MY_VOYAGE_KEY
counterparts credentials list
```

The value comes from stdin or from one named environment variable, never from the
command line, and is never echoed or logged — the command prints
`set ANTHROPIC_API_KEY in /…/credentials.env` and nothing else. It writes the file
the configuration names, creating it 0600 or putting it back to 0600, replaces
that name's line (the template's commented placeholder included) and keeps every
other line and comment. `credentials list` says which of the two names the file
holds — names only.

Restarting is not required for the hooks: each is a fresh process and picks the
file up at the next event. The MCP server reads it once, at launch, so a running
session's `recall` keeps whatever it started with until the session restarts.

### Two things to know about both

**`doctor` will not open a store nobody named when the guard is armed.** In a
shell exporting `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` — this repo's own sessions
do — `counterparts doctor` refuses unless you name a configuration
(`--config <path>`, or `COUNTERPARTS_CONFIG`) or a store (`--dir <path>`). A
configuration found at the default path names the live store, and the guard is
armed precisely so that nothing nobody named gets opened. Without the guard set,
nothing changes: plain `counterparts doctor` reads the default configuration.

**On a red day with a very long wake, the terminal may say nothing.** The host
caps a hook's output at 10,000 characters, and past that it replaces the text
with a preview — which would cost the session its whole wake. So when the wake
plus the notice would not fit, the hook prints the wake alone and drops the
notice (it leaves an `adapter.notice.dropped` row behind). `counterparts doctor`
still prints the finding in full.
