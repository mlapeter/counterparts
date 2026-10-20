# Counterparts Sidebar for Claude Code

<!-- Template for tools/plugin-bundle/build.ts --flavor sidebar: the sidebar plugin's README. -->
<!-- Every line that is only an HTML comment, like these two, is dropped from the output. -->
A pane beside the chat that shows what your counterpart's memory is doing: what came to
mind at each prompt, what was saved this session, which of memory's mechanisms fired today,
and the last dream, with a small fox that looks up when something happens.

It is a Claude Code mod for [Counterparts](https://github.com/mlapeter/counterparts), the
memory itself, which it needs: installing this plugin installs `counterparts` too (its
plugin.json lists it under `dependencies`). The sidebar shows memory; the `counterparts`
plugin, or the npm install, is the memory.

This repository is generated from
[github.com/mlapeter/counterparts](https://github.com/mlapeter/counterparts) at each
release (`tools/plugin-bundle/build.ts --flavor sidebar` there, from `hooks/sidebar/`), so
please open issues and pull requests there.

## Install

In Claude Code (the terminal, on macOS or Linux):

```
/plugin marketplace add mlapeter/counterparts
/plugin install counterparts-sidebar@counterparts
```

Then restart Claude Code. If you didn't have the `counterparts` plugin, it is installed
with the sidebar. If you had it from before the sidebar became a plugin of its own (when
`counterparts` drew the sidebar itself), update it first, or the install stops and says
so; the update is what removes its own sidebar, so you get one pane. In a terminal:

```
claude plugin marketplace update counterparts
claude plugin update counterparts@counterparts
```

If you use the npm install (`counterparts install`), you still get one memory: the
`counterparts` plugin's hooks and memory server stand down for the npm install, and the
sidebar reads the same memory.

The pane opens on its own once the window is wide enough; `/counterparts` opens it,
`/counterparts quiet` hides it.

## What it does

The sidebar shows what memory is doing; apart from one message on a new install, it doesn't
act on its own. It runs no command, calls no tool, starts no process, makes no network
request, and has no buttons: a click on a row opens or folds it, and four kinds of row do
one thing more when you click them.

- **Meet your counterpart**, on the terminal, at the top while the first meeting isn't
  done or skipped, puts `/counterparts:meet` in your prompt box; you press Enter. It only
  fills an empty box and never writes over what is there.
- **The footer's Dashboard line** puts `/counterparts:dashboard` in your prompt box the same
  way. In the desktop app neither row fills the box: the footer says both commands instead.
- **COUNTERPARTS ↗**, on the terminal, is a link to the dashboard while it runs, only ever to
  `http://127.0.0.1` on a port.
- **The view and avatar switches** in the footer: `view` closes the pane to quiet,
  `avatar` turns the fox on or off. Each sets one choice in Claude Code's per-plugin storage.

In the first session of a new memory, before you type anything, it sends one message, "Meet
your new counterpart.", shown as from the plugin, so Claude can introduce itself (once per
memory, never in a `claude -p` run, a paused folder, or after you've typed).

## What it can reach

- **Reads.** `~/.counterparts/sidebar.json`, the status file Counterparts writes for it
  (the day and the count, today's counts per mechanism, the last dream, the recent activity
  log and the memories it names: never conversation text), every 15 to 30 seconds while the
  pane is open; where Counterparts' configuration is (its own hook line in Claude Code's
  settings files, else `COUNTERPARTS_CONFIG`, else `~/.counterparts/claude-code.json`) and
  the scope file beside it; the fox's PNG frames from its own folder; nine environment
  variables (`TERM_PROGRAM`, `TERM`, `KITTY_WINDOW_ID`, `WEZTERM_EXECUTABLE`, `HOME`,
  `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `COUNTERPARTS_CONFIG`, `COUNTERPARTS_SIDEBAR_SESSION`);
  the text hooks add to the session, to find Counterparts' own markers; the name of each tool
  call, and for Counterparts' own the arguments and the result.
- **Runs.** No process, no command, no tool call. The one message above, and on a click a
  command put in your empty prompt box.
- **Sends.** Nothing over the network.
- **Keeps.** In Claude Code's per-plugin storage, the view, theme, avatar and avatar detail
  you choose, and where the first meeting stands. Everything else ends with the session.

Counterparts writes `sidebar.json` while a `counterparts` plugin is installed and on, which
this plugin's dependency makes sure of. Run `claude plugin validate .` in this folder to see
every event it hooks and every call it makes.

## Remove it

To hide the pane, `/counterparts quiet` is enough (`/counterparts` brings it back).

`/plugin uninstall counterparts-sidebar@counterparts` removes the pane and leaves memory as
it is. Claude Code may then offer `claude plugin prune` to remove plugins that were installed
only as dependencies: that includes `counterparts`, the memory itself, so don't run it unless
you want memory gone too. To remove the memory, see the `counterparts` plugin's README.

## License

MIT. See [LICENSE](LICENSE).
