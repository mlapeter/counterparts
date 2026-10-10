# Quickstart

## Install

You need [bun](https://bun.sh) 1.3 or newer, or [Node](https://nodejs.org) 22.15 or newer,
on macOS or Linux. With Node, install with `npm install -g counterparts` instead of the
`bun add` line below; the rest is the same.

```
curl -fsSL https://bun.sh/install | bash     # if you don't have bun
bun add -g counterparts
counterparts --version
```

If `counterparts --version` says `command not found`, add bun's bin folder to your PATH:
`export PATH="$HOME/.bun/bin:$PATH"` in your shell profile.

## Set it up

```
counterparts
```

With nothing set up yet, this offers to set it up. `counterparts install` does the same
thing and is safe to run again. It asks two things, and you can skip either of them:

- **Your name**, so the memory knows what to call you.
- **Whether to connect Claude Code.** This adds five hooks to `~/.claude/settings.json`
  (it keeps a backup first) and registers the memory tools. Hooks from other tools are
  left alone.

There are no API keys. Search by meaning is turned on for you and runs on your machine;
nothing leaves it except through Claude Code itself.

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
counterparts export          # a copy of everything, encrypted by default
counterparts --help          # everything else
```

`counterparts help <command>` explains any command in full.

## Upgrade

Close your Claude Code sessions, then:

```
bun add -g counterparts@latest
```

Your memory isn't changed by an upgrade. Open sessions keep running the old version until
they restart.

Coming from 0.3.13 or earlier, run this once after upgrading. If you connected Claude
Desktop, quit it first:

```
counterparts connect
```

It rewrites the hooks, the memory server's registration and Claude Desktop's entry so
that Bun no longer reads a project's `.env` or `bunfig.toml` into them. Until then
`counterparts doctor`'s Runtime line is amber. Desktop rewrites its own config file while
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

Go back in this order. The other order breaks every hook, and the older version's
`doctor` still reads green.

1. `counterparts disconnect`, while the newer version is still installed.
2. Install the older version, for example `bun add -g counterparts@0.3.13`.
3. `counterparts connect`.
4. If you connected Claude Desktop: quit it, then run `counterparts install --host claude-desktop`.

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
bun remove -g counterparts
```

`uninstall` disconnects Claude Code and keeps your memory. Two options change what
happens to the memory:

- `--park` renames `~/.counterparts` aside. `counterparts install` offers to bring it back.
- `--delete-memories` deletes it, after asking you to type `DELETE MEMORIES`.

Both show your memory's size first. Part of that can be a database log that shrinks on its
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
