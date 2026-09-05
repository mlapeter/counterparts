# Counterparts — install

This is the one canonical install path. `tools/install-loop/run.sh` runs this
page's CONSOLE commands verbatim — each one is grepped out of this file before it
is executed, so a doc edit that changes one fails the loop — in a throwaway home
directory with no copy of this repository on its PATH. It packs the tarball
itself and feeds the hook its own payload. It cannot run `git clone`,
`claude mcp add`, `export PATH` or Claude Code; §9 lists what that leaves
unverified.

No API key required. The scripted version of this page — install, configure,
hook, note, recall, the MCP round trip and the session write — is 33 checks and
runs end to end in two to three seconds; the part that takes you time is §4,
pasting two blocks into Claude Code's own configuration.

---

## 1. What you need

- **[bun](https://bun.sh) 1.3 or newer.** Counterparts ships as TypeScript
  sources and runs them directly; bun is the runtime. `curl -fsSL https://bun.sh/install | bash`
- **npm**, for one command: `npm pack`, in §2, is how you build the tarball while
  the package is unpublished. It comes with Node; a machine set up by the bun
  line above may not have it. (`bun pm pack` exists but is not what §2 was tested
  with, so this page does not tell you to use it.)
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

**Counterparts is not on npm yet, and the repository is not public yet.** When it
is published, this section becomes `bun add -g counterparts` and nothing else.
Neither is true today: nothing is published under the npm name yet, and the clone
below will refuse anyone who is not the author until the repository is flipped
public at launch. **If you are reading this from a tarball somebody sent
you, skip the clone and start at `npm pack` — or at `bun add -g`, if the tarball
is the thing you were sent.** Otherwise:

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

That installs four executables into bun's global bin directory:

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
`init` has no host wiring at all: the hooks will not see it, because they read
one hardcoded configuration path and nothing else.

Both take `--name`, and both mean the same thing by it: the identity core is
minted then and there, by the same door, so a store made either way has it as its
first live row. `counterparts status` on a directory with no store points you at
`init`, which is the right answer for the case you are usually in when you see
that message.

### What `install` writes

Replace `Your Name` with yours. It seeds the identity core — the thing the memory
is *about* — and there is no default for it anywhere. It does not produce visible
output on day 0: a fresh store has lived no boundary, so the identity lane has
nothing to say yet. This command writes three things that are **yours**:

```
~/.counterparts/
├── claude-code.json      the adapter's configuration
├── credentials.env       0600, holding only comments that name the two keys
└── store/                the memory itself — the default data dir
    ├── prose/            the memories, as Markdown you can read in any editor
    ├── versions/         prior versions of a memory that was revised
    ├── operational.sqlite
    ├── cache/            rebuildable index; losing it costs a re-index
    └── tmp/              staging for atomic writes
```

Two more directories appear under `store/` the first time they are needed and not
before: `spans/` (lived experience awaiting encoding, written by the hooks and by
`counterparts note`) and `sessions/` (the live-session registry, §5). A fresh
store has neither, and `counterparts status` lists all of them either way.

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
one path the hooks read — `src/adapters/claude-code/bin/hook.ts` and its worker
hardcode it and take no flag — so a config written anywhere else is an ambient
half that never fires, and no hook will tell you: a hook that stands down says so
on stderr and exits 0 (§5 has the one exception). The hook falls back to
`COUNTERPARTS_DATA_DIR` only when that file names no `dataDir` at all
(`hook.ts:84`), and `install` always writes one.

`install` keeps the config where the hooks look, points its `dataDir` at wherever
you sent the store, and says so in its output when you use `--dir`.

The one `--dir` it refuses is `~/.counterparts` itself, which would put the config
inside the data dir. It says so instead of creating a store that will not open.

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
variable. (The hook still reads its own process environment: the two API keys come
from there first, §6, and the store falls back to `COUNTERPARTS_DATA_DIR` if that
file names none.)

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
default the console uses, `serve.ts:23`. That is a fallback, not a plan.)

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
actually reads (`hook.ts:166-181`, measured; §9). That 2 is the feedback channel,
not a failure.

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
you point at and the credentials you use are chosen by two different files.

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
`injectionBudgetBytes` from `<store>/../claude-code.json`, then from
`~/.counterparts/claude-code.json`, and prints which — and never for the store,
the keys or the embedder.

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

```
counterparts-dashboard status --dir "$HOME/.counterparts/store"
```

The same store, rendered. `browse`, `stories` and the other views take `--id`,
`--limit`, `--band`, `--kind`.

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
  memory's words; the removal strikes them out of it.
```

That directory name is a 12-hex key derived from the project the note was taken
in, not the project's path; the command prints your real one.

A note is captured verbatim into the span buffer before it is minted, and until
2026-09-05 `remove` reached the prose, the database, the links and the cache but
not that file — so a removed note's words survived there, and a backup taken
afterwards copied them. They do not now: the buffer is a chased surface like the
other six. The line the doomed span rode on is rewritten out of every file that
held it (the live streams, any claim a worker is mid-arc on, the quarantine), its
hash is kept in the buffer's own `consumed.jsonl` so nothing re-captures the same
words, and the id goes dark on the deny-list so nothing can quietly resurrect the
memory. Take a backup afterwards and grep it: the words are not there.

On a memory that never rode the buffer the same line reads `spans: not
applicable`, which is stated rather than omitted — a surface that goes silent
when it is empty is how the residue stayed invisible in the first place. One
state is still `NOT chased`, and it is the honest one: a memory whose prose file
is already gone AND whose mint never recorded a span hash cannot be addressed in
the buffer at all. The command says which way it is blind, and counts itself
`unchased: 1`.

### Prove the hook works without opening Claude Code

```
echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook
```

On a store that has never lived a boundary this prints the honest bootstrap line
— *"No briefing has been composed yet — this store has not lived a boundary."* —
and exits 0. That is the wake path working, with nothing yet to say.

**This one reads `~/.counterparts/claude-code.json` and nothing else.** It takes no
`--dir`, so it acts on whatever store that file names — falling back to
`COUNTERPARTS_DATA_DIR` only if the file names no `dataDir` at all — which is the point of §3's rule that the config stays where the hooks look.
If you have not run `counterparts install`, or you are trying it against a scratch
store, this command will not do what you expect: the only way to point the hook
somewhere else is to point that one file somewhere else.

### Give the wake something to say before a first real session

```
counterparts rebrief --dir "$HOME/.counterparts/store"
```

which re-renders and republishes the wake bundle now, through the boundary's own
renderer, advancing no sleep marker. Run the hook again and you get the bundle.

`rebrief` needs an injection ceiling and will not invent one. It takes it from
`--budget <bytes>` if you pass one; otherwise from `<store>/../claude-code.json`;
otherwise from `~/.counterparts/claude-code.json`, which is where the hooks read.
**It always prints which**, as `budget 9000 bytes from <path>` — a ceiling taken
out of a file you did not name should never be silent — and if none of the three
answers, it refuses and lists every path it tried.

To recap which entry point reads what: the console and the dashboard take `--dir`
or `COUNTERPARTS_DATA_DIR`; the MCP server takes `--dir` or
`COUNTERPARTS_DATA_DIR`; the hook and its worker take no flag and read `dataDir`
out of `~/.counterparts/claude-code.json`, falling back to
`COUNTERPARTS_DATA_DIR` only if that file names no store. The console reads that
file only for `rebrief`'s ceiling; the store, the keys and the embedder knob in it
are the hooks' and the MCP server's.

---

## 8. Upgrading

`git pull && npm pack` in the clone, then:

```
bun add -g "$PWD"/counterparts-*.tgz
```

then restart every open Claude Code session (§5). Your store is untouched:
`counterparts install` never rewrites an existing config or credentials file.

---

## 9. What is actually verified, and what is not

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
- `rebrief` names the file its injection ceiling came from, falls back to the
  hooks' config for a store that has none beside it, and refuses — listing every
  path it tried — when nothing supplies one;
- `rebrief` renders a bundle and the next `SessionStart` injects it;
- the dashboard opens the same store.

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
`session_end` binds to that record and mints the memory (loop step 23; the
refusals `session-unknown`, `scope-mismatch` and `session-required` are what the
step fails on). What is still unverified is the same thing as above: that this
happens inside a real Claude Code session, where the id comes from the host
rather than from a script.

---

## 10. Known rough edges

1. **Three entry points, two ways to name the store.** `counterparts` and
   `counterparts-dashboard` read `--dir` or `COUNTERPARTS_DATA_DIR`;
   `counterparts-mcp` reads `--dir` or `COUNTERPARTS_DATA_DIR`;
   `counterparts-hook` and its worker take **no flag**; they read `dataDir` out of
   `~/.counterparts/claude-code.json`, which `install` always writes, and fall
   back to `COUNTERPARTS_DATA_DIR` only when that file names no store. In
   practice, on any installed machine, that one file is the only way to point the
   hook anywhere.
2. **`bun add -g` needs an absolute tarball path — and the same error means "no
   such file".** On bun 1.3.10 a relative path fails with
   `error: ENOENT extracting tarball from ./x.tgz`, and so does an absolute path
   naming a file that does not exist. Check `ls *.tgz`. Hence
   `"$PWD"/counterparts-*.tgz` in §2.
3. **The store you point at and the host settings you get come from two different
   files.** `--dir` / `COUNTERPARTS_DATA_DIR` choose the store;
   `~/.counterparts/claude-code.json` supplies host settings — the embedder knob
   and the credentials file for the MCP server and the hooks, and, as a last
   resort, the injection ceiling for `counterparts rebrief` (§7). Running a
   scratch store on a machine that already has a configured install will use that
   install's keys, and can compose a briefing under that install's ceiling. §6
   says how to tell from the `semantic` field; `rebrief` names the file it read.
4. **The vector cache stores embeddings as JSON text.** On the owner's migrated
   store that is 177 MB at 13.9K vectors, with a nearest-neighbour scan of
   0.6–1.0 s. Irrelevant to a fresh store; a named debt.
5. **`parallel: { enabled: true }`** appears in the owner's live config. It is the
   parallel-run knob and makes Counterparts stand down unless another file says
   it may speak. Do not copy it.
6. **Removal reaches the span buffer — with one named blind spot.** A note is
   captured verbatim into `spans/<12-hex key>/jots.jsonl` before it is minted.
   Until 2026-09-05 `remove` chased the prose, the database, the links and the
   cache and not that file, so a removed note's words survived there and a backup
   taken afterwards copied them. The buffer is chased now (§7). **Check it in
   three lines** — the marker text is only there so `grep` has something to find:

   ```
   counterparts note "ZQPROBE the culvert gate key is under the third fence post." --dir "$HOME/.counterparts/store"
   counterparts remove <the mem_… it printed> --confirm --dir "$HOME/.counterparts/store"
   grep -rl ZQPROBE "$HOME/.counterparts/store"
   ```

   Nothing answers. The blind spot that remains: a memory whose prose file is
   already gone AND whose mint recorded no span hash — an old row, or one whose
   prose you deleted by hand — cannot be addressed in the buffer, and `remove`
   says so on its `NOT chased` line and counts it `unchased: 1` rather than
   reporting `nothing`.
7. **The package ships the modules' own `CONTRACT.md`, `NOTES.md` and
   `INTERFACE-GAPS.md`** — 40 files, 0.45 MB, in a 2.2 MB package (measured
   2026-09-04 on `npm pack --dry-run`, 742.2 kB packed over 168 files, plus the
   tarball's own listing; the TypeScript sources are the bulk of the rest, and
   the Markdown grows as the modules record what they learned). Deliberate: those files are what
   `src/` is documented by, and this page points at them. Delete `src/**/*.md`
   from your install if you would rather not carry them.
