# Sidebar mod v0.1: notes

A Claude Code mod (a module of function hooks) inside the Counterparts plugin:
a memory pane docked beside the transcript, with a header, two switches, the
brain turning in braille, the twelve mechanisms, search, and ACTIVITY. The
approved design is the 10-09 mockup ("Sidebar v2", `drawD` in
`~/counterparts-notes/mockups/2026-10-09-mod/`). This file records what the
build learned. Everything here is a working default.

**Try it** (the whole plugin; its classic hooks and server stand down beside
an npm install, so only the mod runs):

    claude --plugin-dir /Users/mlapeter/counterparts/.claude/worktrees/mod-sidebar

`/counterparts` opens it if the terminal was too narrow, `/counterparts fps`
shows the brain's frame rate, `/counterparts rail` slides it, `/counterparts caps`
swaps the switch ends.

**Check it:** `sh hooks/sidebar/check.sh`, which runs validate on both manifests,
`claude plugin test hooks/sidebar` (32 tests, terminal and desktop) and
`tsc -p hooks/sidebar`, all with a throwaway HOME.

## Layout, and why

- `hooks/hooks.json` names the module under `"modules"` beside the five classic
  hooks; the root `plugin.json` names the state contract (`"types"`).
- `hooks/sidebar/` is a plugin root of its own (a `.claude-plugin/plugin.json`
  also named `counterparts`, so the `$.state` keys match either way).
  `claude plugin test <dir>` runs every `*.test.ts` under `<dir>`; at the repo
  root that would include the 154 bun test files, which can't load in a mod's
  environment, and the runner refuses a folder with no `hooks/hooks.json`.
- `bunfig.toml` sets `[test] root = "./test"`, so `bun test` never picks up the
  mod's tests. It still runs the same 5,319 tests across 154 files.
- The engine's declarations (`.claude-plugin/types/`) are generated per build
  and gitignored. `check.sh` lays them for `tsc`, from the copy a
  `--plugin-dir` session wrote or from the plugin-authoring skill's copy.
- The engine lets `$` pass only to functions declared at the top of the same
  file, so `register.tsx` holds everything that touches the engine. `brain.ts`,
  `cells.ts`, `feed.ts` and `mechanisms.ts` are pure.

## The plumbing questions

| # | Question | Answer | How |
|---|---|---|---|
| 1 | `hooks.json` holds both `"hooks"` and `"modules"`; validate is clean; the classic hooks are still listed | **verified** | `claude plugin validate` passes. Its one warning (CLAUDE.md at the plugin root) is on master too. A `-p` load of the whole plugin registered the five command hooks, ran SessionStart's `plugin-run.sh`, and loaded the module with its seven hooks. |
| 2 | Raster refusal: braille, background colours, Powerline caps U+E0B6/U+E0B4 | **verified**: all three pass; a wide character (U+4E00) is refused and the refused tree draws nothing | `claude plugin test` with mounted Rasters. Whether a terminal *paints* the caps as half-discs depends on the font, and that part is **assumed**. If they look like boxes, `/counterparts caps` switches to `▐ ▌`. |
| 3 | How the switches become clickable | **verified**: a `plain` Button whose children are Text cells carrying `backgroundColor` validates on terminal and desktop, and a press reaches it. Mechanisms and activity rows are Buttons too, one per line. | The test kit, plus a real click (an SGR mouse sequence in a tmux-hosted session) that opened a mechanism. |
| 4 | `$.http.fetch('http://localhost:4747/api/...')` from a mod | **verified**: 200 for `localhost` and `127.0.0.1`, so the Host allowlist passes. A dead port rejects (`ECONNREFUSED`), and the sidebar then says to start `counterparts dashboard`. | A probe mod under `-p`, then the real pane in a tmux-hosted session showing live day, count and activity. |
| 5 | `$.mcp.call` target | **verified, each side apart**: the npm server's tools are `mcp__counterparts__*` and are called as `counterparts`; the plugin's are `mcp__plugin_counterparts_counterparts__*` and are called as `plugin_counterparts_counterparts` (`plugin:counterparts:counterparts` works too). `$.mcp.connect('counterparts')` answers with the plugin's server even when it has stood down with no tools, so the target is read off `$.tool.list()`, npm first. **Assumed**: both connected at once, Mike's case (a unit test covers the choice). | Probe mods with a fake MCP server, one name at a time. |
| 6 | Re-opening the pane with fewer `columns` narrows the dock | **verified, with a floor**: at 200 columns, `columns: 44` gives a dock 45 wide, and re-opening with `columns: 5` narrows it to **24**, not 7. Opening at 44 again restores 45. **Assumed** from the docs: a width the person dragged wins. | Real session in tmux. |

Found on the way (each **verified** unless marked):

- **`$.mcp.call` goes through the permission check** and can open a dialog
  ("Tool use · from the counterparts plugin … Yes / No"). The debug log shows
  `$.mcp.call` → `$.tool.call` → permission. The 2.1.295 and 2.1.296 doc
  comments both say "No permission prompt". So the sidebar never calls the
  server unasked unless `$.tool.check` says `allow`. A press may ask, because
  the person just asked. The dialog offered only Yes or No; an allow rule for
  `mcp__counterparts__recall` / `__scope` in settings ends the asking. (Mike runs
  in auto mode; whether its classifier passes these quietly is **assumed**,
  not measured.)
- The recall block arrives at `session.append` as door `hook-context`, name
  `hook_additional_context`, origin `{ kind: 'hook', event: 'UserPromptSubmit' }`,
  inside a system reminder (a `-p` run with a settings hook printing a block).
- Claude memory: `prompt.context` lists MEMORY.md as an instruction file of kind
  `memory`. Filtering it out on the way down makes core re-render `claudeMd`
  without it, and the stored first message lacks it. `prompt.section` `memory`
  fires and takes `{ text: null }`. **Assumed** from the docs: invalidating both
  takes effect from the next message and busts the prompt cache once.
- The engine heads every plugin status line with `⚠ <plugin>:`, so the line
  drops the name ("◉ day 18 · 782 memories · 1 kept").
- The dark theme fills a docked pane with a grey (256-colour 235). The
  transcript keeps the terminal default.
- A `--plugin-dir` folder hot-reloads in an interactive session. On a reload
  `session.start` runs again, the timers start over, and `$.state` survives.
- An unasked pane waits undrawn below 144 columns (**assumed** from the docs).
  The status line then says `/counterparts opens the sidebar`.

## The frame rate, measured

The brain repaints on `$.clock.every(1000 / target)` with `$.ui.blit`. Each
blit's completion time and each frame's compute time are recorded.
`/counterparts fps` reports them and toggles a ` · N fps` suffix on the status
line. In a tmux-hosted session (200 x 60, 256 colours) it read **9.1 fps
achieved at a target of 10 (6.2 ms a frame), and 13.7 fps at a target of 15
(2.6 ms a frame)**. `/counterparts fps <1-30>` sets the target, which is kept.
That restarts the timer from the command's own `$`, which works live, as do the
30 s auto-closes started from a press. Mike's first real run is the real
measurement.

## Where the design changed, and why

- **The sidebar paints its own background** (`#05080c`, the mockup's black),
  the brain's empty cells included. The dock's grey made the navy glow read as
  a dark box. In a light theme the palette would have been unreadable.
- **Search runs on Enter, not on every keystroke.** Each `recall` writes a count
  row (it counts under Retrieval's "deliberate look-ups") and the "shown this
  session" bookkeeping. Typing "publish" would have made seven.
- **Esc doesn't clear the search.** Esc hands the keyboard back to the prompt
  and never reaches a mod's Input. Clearing is the `✕` beside the field, or an
  empty Enter.
- **The Counterparts switch starts dim when the folder's state isn't known.**
  Asking at start would open a permission dialog (above). The first press
  learns the state (and toasts it). After that, each press pauses or resumes,
  one call each.
- **The rail is 24 columns wide, not 7**: that is the dock's floor (#6).
- **No slide animations.** The mechanism line and an opened row appear and
  close at once (still on a second press or after 30 s).
- The activity word column is 13 wide, because a recall row's word carries its
  count ("3 recalled").
- On a cold start, ACTIVITY asks `/api/activity?name=` once for each event that
  proves a mechanism (18 small reads). One `?limit=300` read was 290 KB and
  covered 40 minutes of mostly flow noise. After that, `/api/pulse` every 5 s,
  and `?sinceSeq=` only when `lastSeq` moves.

## Known gaps (v0.1)

- TODO: the desktop's brain as an `Svg` (Raster is the terminal's alone). The
  desktop shows a placeholder.
- TODO: the install-bun card; opening one memory by id on the dashboard (links
  land on `#memories`); fork write-ups.
- A sidebar search is a `recall` like the model's: it counts as a deliberate
  look-up on the dashboard. It also records which memories the answer showed
  this session, so a later reply quoting those words could credit them. A
  search strengthens nothing by itself.
- The facts-answer parser follows `adapters/mcp/facts.ts#renderFacts` (doc and
  code); the live check's fake server didn't speak that format.
- The event-to-mechanism table in `feed.ts` copies
  `adapters/mechanism-evidence.ts` (a mod can't import from outside its folder).
  A mechanism added there shows here only once this copy learns it.
- A came-to-mind row is matched to its dashboard twin by session id and turn.
  That assumes the store's session id is Claude Code's (true in today's feed).
- The brain timer keeps ticking (one dispatch per frame) while the pane is
  hidden. It computes nothing until the pane draws again.
- Unexplained: once, in the tmux session, focusing the pane with ctrl+x tab and
  then Enter widened the dock to about 60 columns. Not reproduced.
