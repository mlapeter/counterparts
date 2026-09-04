# Counterparts — install

This is the one canonical install path. `tools/install-loop/run.sh` runs every
command on this page, verbatim, in a throwaway HOME, and fails if a command here
and a command there stop matching — so the page and the machine cannot drift.

No API key required. The scripted version of this page — install, configure,
hook, note, recall — runs end to end in about two seconds; the part that takes
you time is §4, pasting two blocks into Claude Code's own configuration.

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

**Counterparts is not on npm yet.** When it is published, this section becomes
`bun add -g counterparts` and nothing else. That is not true today — the name is
reserved and nothing has been pushed to it — so until then you build the tarball
yourself, which takes one command:

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

Replace `Your Name` with yours. It seeds the identity core — the thing the memory
is *about* — and there is no default for it anywhere. It does not produce visible
output on day 0: a fresh store has lived no boundary, so the identity lane has
nothing to say yet. This command writes three things that are **yours**:

```
~/.counterparts/
├── claude-code.json      the adapter's configuration
├── credentials.env       an empty 0600 file for your API keys
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
hardcode it, with no flag and no environment override — so a config written
anywhere else is an ambient half that never fires, and every hook exits 0 by
design, so nothing would ever tell you. `install` keeps the config where the hooks
look and points its `dataDir` at wherever you sent the store, and says so in its
output when you use `--dir`.

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
everything else, so it takes no arguments and no environment.

**The MCP server.** Run the line `counterparts install` printed; its shape is:

```
claude mcp add counterparts -s user -e COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store" -- "/abs/path/to/bun" run "/abs/path/to/counterparts/src/adapters/mcp/bin/serve.ts"
```

`COUNTERPARTS_DATA_DIR` in that line is **not optional**. Claude Code launches MCP
servers from a static configuration with no per-session substitution, so the
server gets no session id and no working directory it can trust; the data dir is
how it finds the same store the hooks are writing. Use an absolute path — for the
same PATH reason as above.

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
  "considered": 1, "storeSize": 2, "returned": 1, ... }
```

The values, and exactly what each one means
(`src/adapters/mcp/server.ts#embedQuestion`, `deliberate.ts#answerQuestion`):

| `semantic` | meaning |
|---|---|
| `embedder-off` | no embedder was built. Either no `VOYAGE_API_KEY`, or `embedder.enabled` is absent from the config. **This is the no-key mode.** |
| `in-line` | the question WAS embedded and the semantic channel ran. You have a key and the knob on. |
| `embed-failed` | an embedder exists and the call returned nothing or threw. Lexical answered; the failure is named rather than hidden. |
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

First, tell the console which store, once for this shell:

```
export COUNTERPARTS_DATA_DIR="$HOME/.counterparts/store"
```

Every command in this section takes `--dir <store>` instead if you prefer; the
console and the dashboard read one or the other, and neither reads
`claude-code.json`. Put that `export` in your shell profile and you never think
about it again.

### Store a memory and ask for it back

This is the product. Two commands, no host, no keys:

```
counterparts note "The espresso machine in the kitchen is a Rancilio Silvia."
counterparts recall "what espresso machine is in the kitchen?"
```

`note` prints `Remembered mem_… — minted.` `recall` prints a header line and the
memory:

```
question · answered · semantic embedder-off · considered 1 of 2 live · returned 1

  mem_b77c9e0e9808  [quiet] fact
    The espresso machine in the kitchen is a Rancilio Silvia.
```

These are the same two doors the MCP tools use — `note` captures the words into
the span buffer and then deposits a draft that claims that span by hash; `recall`
calls the same deliberate-recall dispatcher — so what you see here is what Claude
Code will see. `--kind`, `--title` and `--salience` shape a note; `--id <mem_…>`
asks for one memory in full instead of asking a question; `--json` prints the
tool's own payload.

**A known failure you may hit on the very first one.** On a store holding exactly
one memory, the question path currently scores no candidates and answers
`nothing-came · considered 0 of 1 live`. The memory is stored and is retrievable
by `--id`; only the search path is blind at store size one, and writing any second
memory makes the first findable. This is a real bug, reproduced on four stores by
the 2026-09-04 cold-stranger review, and it is being fixed. Until it lands, if
your first recall comes back empty, write a second note and ask again.

### Look at the store

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

### Prove the hook works without opening Claude Code

```
echo '{"hook_event_name":"SessionStart","session_id":"smoke","cwd":"'"$PWD"'"}' | counterparts-hook
```

On a store that has never lived a boundary this prints the honest bootstrap line
— *"No briefing has been composed yet — this store has not lived a boundary."* —
and exits 0. That is the wake path working, with nothing yet to say.

**This one reads `~/.counterparts/claude-code.json` and nothing else.** It takes no
`--dir` and honors no environment variable, so it acts on whatever store that file
names — which is the point of §3's rule that the config stays where the hooks look.
If you have not run `counterparts install`, or you are trying it against a scratch
store, this command will not do what you expect: the only way to point the hook
somewhere else is to point that one file somewhere else.

### Give the wake something to say before a first real session

```
counterparts rebrief --dir "$HOME/.counterparts/store"
```

which re-renders and republishes the wake bundle now, through the boundary's own
renderer, advancing no sleep marker. Run the hook again and you get the bundle.

To recap which entry point reads what: the console and the dashboard take `--dir`
or `COUNTERPARTS_DATA_DIR`; the MCP server takes `--dir` or
`COUNTERPARTS_DATA_DIR`; the hook and its worker read `dataDir` out of
`~/.counterparts/claude-code.json` and take neither. **The console does not read
`claude-code.json`** — that file is the hooks' and the MCP server's.

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
- **and the one-memory case, which is EXPECTED TO FAIL today** (§7): one note in a
  fresh store, recalled by question, is reported as a known failing step rather
  than skipped, so it cannot quietly stop being fixed;
- `rebrief` renders a bundle and the next `SessionStart` injects it;
- the dashboard opens the same store.

**The loop cannot launch Claude Code.** So these are *unverified by it* and only a
real session can settle them: that Claude Code reads the hooks block from
`settings.json` and runs `counterparts-hook` on all five events; that the wake
text actually reaches the model's context; that the Stop ask arrives (it is
delivered on stderr with exit 2, the one channel measured to work on this host);
that `claude mcp add` registers a server the client then launches; and that
`session_end` binds to a live session through the registry. All five are verified
on the owner's machine by the parallel run
([`docs/PARALLEL-RUN-STATUS.md`](https://github.com/mlapeter/counterparts/blob/master/docs/PARALLEL-RUN-STATUS.md),
in the repository), not by this loop.

---

## 10. Known rough edges

1. **The first memory in a fresh store is not findable by question.** §7 has the
   detail. Stored, indexed, retrievable by `--id`; the search path scores no
   candidates at store size one. Being fixed; the install loop carries it as an
   expected failure so it cannot be forgotten.
2. **Three entry points, two ways to name the store.** `counterparts` and
   `counterparts-dashboard` read `--dir` or `COUNTERPARTS_DATA_DIR`;
   `counterparts-mcp` reads `--dir` or `COUNTERPARTS_DATA_DIR`;
   `counterparts-hook` and its worker read `dataDir` out of
   `~/.counterparts/claude-code.json` and accept **neither** a flag nor an
   environment variable. There is no way to point the hook at a different store
   except by editing that file, which is why `install` always writes it there.
3. **`bun add -g` needs an absolute tarball path — and the same error means "no
   such file".** On bun 1.3.10 a relative path fails with
   `error: ENOENT extracting tarball from ./x.tgz`, and so does an absolute path
   naming a file that does not exist. Check `ls *.tgz`. Hence
   `"$PWD"/counterparts-*.tgz` in §2.
4. **The store you point at and the credentials you use come from two different
   files.** `--dir` / `COUNTERPARTS_DATA_DIR` choose the store;
   `~/.counterparts/claude-code.json` chooses the embedder knob and the
   credentials file, for the MCP server as well as the hooks. Running a scratch
   store on a machine that already has a configured install will use that
   install's keys. §6 says how to tell from the `semantic` field.
5. **The vector cache stores embeddings as JSON text.** On the owner's migrated
   store that is 177 MB at 13.9K vectors, with a nearest-neighbour scan of
   0.6–1.0 s. Irrelevant to a fresh store; a named debt.
6. **`parallel: { enabled: true }`** appears in the owner's live config. It is the
   parallel-run knob and makes Counterparts stand down unless another file says
   it may speak. Do not copy it.
7. **The package ships the modules' own `CONTRACT.md`, `NOTES.md` and
   `INTERFACE-GAPS.md`** — about 1.9 MB unpacked. Deliberate: those files are what
   `src/` is documented by, and this page points at them. Delete `src/**/*.md`
   from your install if you would rather not carry them.
