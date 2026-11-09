# Quickstart

## Install

You need [Node](https://nodejs.org) 22.15 or newer, or [bun](https://bun.sh) 1.3 or newer,
on macOS, Linux and Windows (Windows is new: tell us how it goes). Bun on macOS is the setup
in daily use; Node, Linux and Windows pass a smoke test and an install run but have no daily
user yet. On Windows, read [On Windows](#on-windows) below first.

```
npm install -g counterparts@latest
counterparts --version
```

Keep the `@latest`: a bare `npm install` can fetch an older version. With bun instead:
`bun add -g counterparts`; the rest is the same. Whichever runtime runs the setup is the one
Claude Code's hooks and memory tools are wired to.

If `counterparts --version` says `command not found`, your global bin folder isn't on your
PATH: for npm, add the folder `npm prefix -g` prints, plus `/bin`; for bun, add
`export PATH="$HOME/.bun/bin:$PATH"` to your shell profile.

Or install it as a Claude Code plugin: `/plugin marketplace add mlapeter/counterparts`, then
`/plugin install counterparts@counterparts`, then restart Claude Code. The plugin sets
itself up on its first session and puts no `counterparts` command on your PATH:
`/counterparts:doctor` checks it, and the rest of this page is for the npm or bun install.

### On Windows

Windows is new, and has few users yet: if something here goes wrong, tell us
([issues](https://github.com/mlapeter/counterparts/issues)). What differs from macOS and Linux:

- Install with **npm and Node** 22.15 or newer, from PowerShell, cmd or Git Bash. The commands on
  this page are the same in all three.
- Your memory lives in `%USERPROFILE%\.counterparts\`, and `counterparts connect` writes to
  `%USERPROFILE%\.claude\settings.json` and `%USERPROFILE%\.claude.json`, where Claude Code
  keeps them on Windows.
- Claude Code runs the hooks in Git Bash when Git for Windows is installed, and in PowerShell
  when it isn't. Both work. The hooks name `node` by name, so keep the Node you installed
  with on your PATH; run `counterparts connect` again after moving to another Node.
- If PowerShell says running scripts is disabled on this system (Windows' default, and it
  says the same for `npm`), type `counterparts.cmd` in place of `counterparts`, use cmd or
  Git Bash, or allow scripts for your account once:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. The hooks don't need this: they
  start `node` itself.
- npm makes `counterparts` work in PowerShell and cmd with a small step that runs after the
  install. If you install with `--ignore-scripts`, that step doesn't run, and the command
  works only from Git Bash: run `npm install -g counterparts@latest` again without it.
- `counterparts uninstall` and `start-fresh` can't see which Counterparts processes are still
  running on Windows: quit Claude Code first.
- In WSL, Counterparts works as it does on Linux: install it inside WSL, and run Claude Code
  there too.

## Set it up

```
counterparts
```

With nothing set up yet, this offers to set it up. `counterparts install` does the same
thing and is safe to run again. It asks two things, and you can skip either of them:

- **Your name**, so the memory knows what to call you.
- **Whether to connect Claude Code.** This adds five hooks to `~/.claude/settings.json`
  (it keeps a backup first), registers the memory tools, and adds one `deniedMcpServers`
  entry so the Counterparts Online connector never loads into Claude Code as a second memory.
  Hooks and settings from other tools are left alone.

There are no API keys. Search by meaning is turned on for you and runs on your machine,
and your memory leaves it only through Claude Code itself. Counterparts makes one request
of its own: once a day, the background worker that Claude Code's hooks start asks
registry.npmjs.org for the newest version number, and sends nothing about you or your
memory. To stop it, set `"updateCheck": false` in `~/.counterparts/claude-code.json`, or ask
Claude to stop the update reminders. `COUNTERPARTS_UPDATE_CHECK=off` or Claude Code's
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` stops it too, set in the environment Claude Code
runs in.

Your memory lives in `~/.counterparts/`.

**Claude Desktop** (macOS): `counterparts install --host claude-desktop` connects its chats to
the same memory. Then, in Claude Desktop, set the counterparts tools to **Always allow**, or a
chat cannot wake on its own: Desktop asks before each tool, and until it may, the model does
not call one nobody asked for.

To set it up from a script, with no questions:

```
counterparts install --budget 9000 --name "Your Name"
counterparts connect
```

A script setup doesn't change Claude Code's settings (it prints the hooks instead);
`counterparts connect` is the step that does. Keep `--budget 9000`: only the questions
fill in that size limit for you. Search by meaning is on for a script setup too; add
`--no-embedder` to leave it off.

## Check it

Restart Claude Code, then run:

```
counterparts doctor
```

Green means working. **OFF** means an optional feature you haven't turned on, which is
fine. Amber is worth a look. Red means something isn't running; the line under it says
what to run to fix it.

A session that was already open picks up the hooks on its next message, but it only gets
the memory tools after a restart.

## Choose which directories it remembers

Memory is on in every directory by default. The first session in a new directory asks
whether you want it there. To change a directory later, run one of these from inside it:

```
counterparts scope . --off        # don't remember anything here
counterparts scope . --observer   # use the memory here, but don't add to it
counterparts scope . --pause      # off for now
counterparts scope . --resume     # back on
counterparts scope .              # what's set here
counterparts scope --list         # every directory you've set
```

Settings apply to subdirectories too.

## Look at the memory

```
counterparts dashboard       # opens the dashboard in your browser (read-only)
counterparts ask "..."       # ask the memory a question
counterparts status          # how much it holds
counterparts self-page       # who it thinks it is, and who you are
counterparts remove          # delete one memory for good
counterparts export --out <dir> --passphrase <secret>   # an encrypted copy of everything
counterparts --help          # everything else
```

Export needs `--passphrase` or `--plaintext` (a plain copy); it won't pick for you. No
command opens an encrypted export yet: the README written beside it gives the format
(scrypt and AES-256-GCM), so it can be opened by hand.

`counterparts help <command>` explains any command in full.

## Upgrade

Close your Claude Code sessions, then:

```
npm install -g counterparts@latest
```

With bun, the same step is `bun add -g counterparts@latest`. Keep the `@latest`: a bare
`npm install` can fetch an older version.

Your memory isn't changed by an upgrade. Open sessions keep running the old version until
they restart.

Coming from 0.3.37 or earlier, run this once after upgrading. If you connected Claude
Desktop, quit it first:

```
counterparts connect
```

It adds one entry to `deniedMcpServers` in `~/.claude/settings.json`, so a claude.ai
connector to Counterparts Online is never loaded into Claude Code as a second memory
beside this one, leaving everything else in the file as it is. Until then `counterparts
doctor`'s Online line is amber. Coming from 0.3.13 or earlier, or from 0.3.14 with Claude
Desktop connected, it also rewrites the hooks, the memory server's registration and Claude
Desktop's entry so that Bun no longer reads a project's `.env` or `bunfig.toml` into them;
until then the Runtime line is amber too. Desktop rewrites its own config file while
it's open, so `connect` leaves Desktop's entry alone while Desktop runs, and says so.

If you set it up before search by meaning was built in, it turns on by itself after the
upgrade. An older setup that used a Voyage or Anthropic key keeps working without it:
those settings are ignored now, and `counterparts doctor --all` lists them as old
settings you can delete (along with `~/.counterparts/credentials.env`, if you have one).
To turn search by meaning on after switching it off (your name and other settings are
kept):

```
counterparts install --force --embedder
```

### Going back to an earlier version

If the upgrade changed your memory's format, the older version won't open it until you
put the old one back. Close your Claude Code sessions, quit Claude Desktop and stop the
dashboard, then, while the newer version is still installed:

```
counterparts rollback
```

It puts back the copy the upgrade made first (they're kept 14 days), says how many
memories you would lose (everything remembered since the upgrade), and asks you to type a
word. Nothing is deleted: the upgraded memory is set aside next to it, in a
`rollback-aside-…` folder. Until you install the older version, the newer one leaves your
memory alone, and sessions on it say why. `counterparts rollback --undo` puts the
upgraded memory back if the older version hasn't used it yet;
`counterparts rollback --upgrade-again` lets the newer version upgrade it again.

Then go back in this order. The other order breaks every hook, and the older version's
`doctor` still reads green.

1. `counterparts disconnect`, while the newer version is still installed.
2. Install the older version, for example `bun add -g counterparts@0.3.13`.
3. `counterparts connect`.
4. If you connected Claude Desktop: quit it, then run `counterparts install --host claude-desktop`.

Going from 0.3.27 or later back to 0.3.26 or earlier also needs the search index rebuilt,
because 0.3.27 changed its format and `rollback` does not cover it. After step 2, delete
`~/.counterparts/store/cache/cache.sqlite` (and the `cache.sqlite-wal` and
`cache.sqlite-shm` beside it), then run `counterparts verify --rebuild --keep-vectors
--dir ~/.counterparts/store`. Recall by meaning comes back over the next few sessions.

## Start over

To set your memory aside and start with a blank one, close every Claude Code session and
dashboard, then run this from a plain terminal:

```
counterparts start-fresh
```

It renames your current memory aside rather than deleting it. `counterparts start-fresh
--undo` puts it back.

## Uninstall

```
counterparts uninstall
npm uninstall -g counterparts      # or, if bun installed it: bun remove -g counterparts
```

`uninstall` disconnects Claude Code, removes the backups of `~/.claude/settings.json` that
connecting and disconnecting kept, then asks whether to delete your memory too:

```
Also delete all memories and related data? This can't be undone. [y/N]
```

Above the question it lists every path that would go (the store, its snapshots, the
configuration, the `~/.counterparts` folder) with its size, and what it leaves alone
(Claude Code's own files). Enter keeps your memory. A yes asks you to type `DELETE MEMORIES`
before anything is deleted. It doesn't ask while a Claude Code session, the dashboard or the
worker has the memory open: close them and run it again.

Options:

- `--keep-memories` keeps your memory without asking.
- `--yes` skips the "Go ahead?" question. A script or a pipe needs it, or uninstall
  refuses before changing anything: `counterparts uninstall --keep-memories --yes`
  (`--park --yes` works the same way).
- `--park` renames `~/.counterparts` aside. `counterparts install` offers to bring it back.
- `--delete-memories` deletes it, after asking you to type `DELETE MEMORIES`. It has no `--yes`, so a script can't run it.

Each shows your memory's size first. Part of that can be a database log that shrinks on its
own; nothing is lost when it does.

To disconnect Claude Code without uninstalling, run `counterparts disconnect`.
`counterparts connect` reconnects it.

## Install from source

```
git clone https://github.com/mlapeter/counterparts.git
cd counterparts
npm pack
bun add -g "$PWD"/counterparts-*.tgz
```

The tarball path must be absolute. To work on the code instead, see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
