# Counterparts as a Claude Code plugin (prototype, 2026-10-09)

Status: a prototype on a branch, for review. Nothing here is submitted or
published; that is the owner's call.

## What it is

The repository root is the plugin. Claude Code reads four things from it:

| File | What it does |
| :- | :- |
| `.claude-plugin/plugin.json` | The manifest: name `counterparts`, version (kept equal to `package.json`), and the MCP server, declared inline |
| `.claude-plugin/marketplace.json` | A one-plugin marketplace (`source: "./"`), so `mlapeter/counterparts` can be added as a marketplace |
| `hooks/hooks.json` | The five events `counterparts install` wires: SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact |
| `commands/doctor.md` | `/counterparts:doctor`, because a plugin install puts no `counterparts` on PATH |

Every hook and the server run `sh ${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh hook|mcp`.
That launcher finds a runtime (below) and runs the same entry points the npm bins run.

Why the root, and why it leaves npm alone:

- Claude Code copies only the plugin folder, and every path a plugin runs must be
  inside it. At the root, the sources are already inside it.
- None of `.claude-plugin/`, `hooks/` or `commands/` is in `package.json#files`, so
  the npm tarball is unchanged. `src/adapters/plugin-run.sh` ships in the tarball
  (it is under `src/`), where it does nothing unless something runs it.
- There is no root `.mcp.json`. One would also be project-scope MCP config for every
  Claude Code session opened in this repository. The server is declared inline in
  `plugin.json` instead.
- There is no top-level `bin/`. Claude Code puts a plugin's `bin/` on PATH, but chat
  and Cowork refuse to install a plugin that has one.
- A mod would go in the same `hooks/hooks.json`, as `"modules": ["./<file>.ts"]`
  beside `"hooks"`. `claude plugin validate` accepts both together. In a throwaway
  probe (2.1.295, `--init-only`), the classic SessionStart hook ran and the mod
  loaded and registered beside it.

## How it behaves

**Runtime.** The launcher takes, in order: `COUNTERPARTS_RUNTIME` if it is set; else
Bun 1.3+ (PATH, `$BUN_INSTALL/bin`, `~/.bun/bin`, Homebrew); else Node 22.15+ (PATH,
Homebrew, `/usr/local`, Volta, nvm, fnm, asdf, mise). An older Node is skipped. With no
runtime at all, SessionStart shows the person one line naming what to install, and
every other event exits 0 quietly. The server exits 127 with the same line on stderr,
which `/mcp` shows. Claude Code's native binary can't stand in as a runtime:
`BUN_BE_BUN=1` is ignored (measured on 2.1.295).

**First run, no terminal.** If `~/.counterparts/claude-code.json` doesn't exist, the
first plugin process to start runs `counterparts install --no-connect` and drops its
output. That writes the store and its configuration and nothing of the host's. A lock
in the temp directory makes the hook and the server, which start together, produce
one install between them. The session's wake then carries one line: "first run — a
new memory was set up at ~/.counterparts". This is skipped if a configuration was
named, or if `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is set.

**The memory isn't in the plugin's data directory.** Claude Code deletes
`~/.claude/plugins/data/<id>/` on uninstall. The store lives where the npm install
puts it, `~/.counterparts/store`, so uninstalling the plugin leaves the memory alone.
It also means moving between the two installs moves nothing.

**Both installs at once.** Claude Code runs hooks from settings and from plugins
side by side. It drops a plugin's MCP server as a duplicate only when the command is
identical, and ours never is. So when the npm wiring is live, the plugin stands down:

- Hooks: if a live hook of ours is in user, project or local settings, the plugin's
  hooks exit at once. At SessionStart the person sees one line about it:
  "installed twice … run `counterparts disconnect` …".
- Server: if a live `counterparts` server is registered in user or local scope, the
  plugin's server answers the protocol with no tools. It puts the reason in
  `instructions`, so `/mcp` shows connected, not failed.
- An npm entry is dead when its runtime or script is gone. Nobody stands down for
  a dead entry; the plugin runs and names the stale lines.

The rule has to live on the plugin side because npm installs already out there
can't learn about the plugin.

**Moving from npm to the plugin:** install the plugin, then run `counterparts
disconnect` (it removes the settings hooks and the `claude mcp` registration, with
a backup) and restart Claude Code. Same store, same memories.

**Moving from the plugin to npm:** `npm i -g counterparts`, then `counterparts
install`. Once its wiring is live, the plugin stands down by itself; uninstall the
plugin to tidy up.

**doctor knows the plugin.** `/counterparts:doctor` (or `counterparts doctor`) reads
Claude Code's own record of installed plugins (`installed_plugins.json` and
`enabledPlugins`). With the plugin alone, its Claude Code line is green: "connected as
the Claude Code plugin". With both installs, the line is amber and names both ways out.
Without this, a plugin user was told "no hook of ours is connected — run `counterparts
connect`", which would have wired the host twice.

**Tool names change.** Plugin tools are `mcp__plugin_counterparts_counterparts__<tool>`,
not `mcp__counterparts__<tool>`. Permission rules a person wrote for the old names
won't match. The nightly run is unaffected: it starts its own server under the old
name with `--strict-mcp-config`.

## The automated loop

`tools/plugin-loop/run.sh [workdir]` runs everything below in a throwaway HOME and
refuses the real one. Before anything could fire a hook, it proves isolation three
ways: `plugin list` shows none of the real plugins, `auth status` names the throwaway
config directory, and a `--debug-file` names every settings path Claude Code looked
at. Then it:

1. snapshots the working tree into a git repository and validates it
   (`claude plugin validate`);
2. adds the repository's own `marketplace.json` from its path;
3. installs through a git source, the same path a GitHub source takes: clone, copy
   into `~/.claude/plugins/cache`, dependency install from `bun.lock`;
4. checks the cached copy has no `.git`, and that `counterparts-model-potion` was
   installed;
5. runs `claude --init-only`, which fires the plugin's SessionStart for real: first
   run, store created, wake delivered;
6. runs `claude mcp list`, where Claude Code starts the plugin's server from the
   plugin root and it connects;
7. writes a note and recalls it through the plugin's server, finds it again with the
   console, and captures a turn through the plugin's hook command into the store's
   buffer;
8. wires the npm hooks as well and checks there's one wake plus the stand-down line;
   removes them and checks the plugin wakes on the same store;
9. uninstalls the plugin and checks `~/.counterparts` is intact.

It never logs in. A model turn needs a login, and the loop copies no credential.

## Manual checklist (needs a login or a GUI)

A. **A real session in a throwaway home.** Set both `HOME` and `CLAUDE_CONFIG_DIR`
to a new directory before `claude`, so the login lands in the throwaway config and
not the real one. Then:

- `/plugin marketplace add mlapeter/counterparts` (or a local checkout path), then
  `/plugin install counterparts@counterparts`, then restart.
- The first prompt shows the "first run" line, and the reply shows the wake was read.
- Tell it something specific. Then `/counterparts:doctor` and `/mcp`: the server is
  connected, with nine tools.
- Quit, start again, and ask what it remembers.
- With the npm install also wired there, see one wake and the "installed twice" line.

B. **Claude Desktop, Code tab.** Same plugin, installed with `/plugin` in the Code
tab or in the terminal on the same machine. This is the one to watch: a Desktop
app started from the Dock may not have the login shell's PATH. The launcher's
fixed-location search (`~/.bun/bin`, Homebrew, nvm…) is there for that case. Check
that the wake arrives and `/mcp` shows the server.

C. **Cowork.** Install from claude.ai (Customize > Plugins, adding the GitHub
marketplace), on a Cowork session that runs on this computer. Per the platform table,
Cowork loads hooks and local servers in that case. Open questions:

- Does Cowork run the `bun.lock` dependency install?
- What PATH do its hooks get?
- Does it fire all five events?

Chat (web, desktop, mobile) ignores both hooks and local servers, so Counterparts
does nothing there.

D. **`claude plugin eval`** calls the model with the user's credentials and costs
usage, so it isn't in the loop. A first case would be: seed a note through the
server, then ask about it. Grade with a `regex` grader on the noted detail, with a
no-plugin baseline arm.

E. **A machine with neither Bun nor Node** (the native installer only). Expect the
SessionStart line naming what to install. Also expect Claude Code's `/plugin` note
that the packages didn't install, because the dependency install needs `bun` on PATH
when the lockfile is `bun.lock`.

## Disclosure (draft text for the README, if this is listed)

> Counterparts runs on your computer. Its hooks read the transcript Claude Code
> keeps for each session and store memories in `~/.counterparts`. Counterparts
> itself sends nothing anywhere. Installing the plugin downloads one npm package,
> `counterparts-model-potion` (about 30 MB, a word-embedding table used to recall by
> meaning), from the npm registry. Dreaming, the nightly consolidation, asks first by
> default. If you choose `auto`, the first session of each day starts a background
> `claude -p` run: your own Claude Code and your own plan's usage, allowed only
> Counterparts' memory tools, with file, shell and web tools denied. It says so in
> one line when it starts. Saying "no dreams" in a session turns it off.
