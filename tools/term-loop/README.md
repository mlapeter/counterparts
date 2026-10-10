# `tools/term-loop` — the sidebar as a real terminal shows it, as PNGs

The sidebar mod (`hooks/sidebar/`) is judged by eye, and its eye is a
terminal. This starts `claude --plugin-dir <dir>` in a detached tmux session,
in the fullscreen layout where the pane docks beside the transcript, runs a
list of steps (slash commands, keys, mouse clicks), captures each state with
its 24-bit colours, draws each capture as an exact cell grid in HTML, and
shoots that with headless Chrome at 2x. A builder iterates on the look; a
separate reviewer judges the PNGs.

Its web twin is `tools/visual-loop/` (the dashboard); the brain alone is
`tools/brain-lab/`.

## Once, per machine

tmux (`brew install tmux`), Google Chrome in `/Applications` (or
`TERM_LOOP_CHROME=<binary>`), and Claude Code logged in. Nothing to install
from npm.

## Every time

```sh
# the three views, from a frozen copy of the mod (hooks/sidebar/NOTES.md says how to make one)
bun tools/term-loop/shoot.ts --plugin-dir ~/counterparts-trials/sidebar-v01-ff3d732f \
  shot:full 'cmd:/counterparts quiet' shot:quiet 'cmd:/counterparts hide' shot:hidden

# a legend item opened, a switch hovered, a search typed (not run)
bun tools/term-loop/shoot.ts --plugin-dir <dir> \
  click:Salience shot:legend 'hover:Counterparts memory' shot:hover \
  'click:search memories' type:publish shot:typed

# draw a saved capture again after changing render.ts (no claude, no tmux)
bun tools/term-loop/shoot.ts --render tools/term-loop/out/<time>/full.ansi --out /tmp/again
```

`--plugin-dir` defaults to this checkout. Options: `--out <dir>` (default
`tools/term-loop/out/<time>`, gitignored), `--size 200x60`, `--crop
auto|none|<N>`, `--settle <ms>` (2500: the dashboard's first read),
`--timeout <ms>` (45000), `--no-cursor`, `--cwd <dir>`, `--claude <bin>`,
`--allow-cmd </name>`, `--mode <mode>` (below). `--help` prints them all.

A run of the three views takes about 16 s: about 4 s until the pane has
drawn, 2.5 s of settling, about 2 s a command, a few seconds to exit, and
about 1 s a PNG.

## Steps

Run in order; with none, `shot:full`.

| Step | What it does |
|---|---|
| `shot:<name>` | captures the screen: `<name>.png` (the whole terminal), `<name>-sidebar.png` (the dock: from its divider to the right edge, over the rows the divider spans), and `<name>.ansi`, `.json`, `.html` beside them |
| `wait:<ms>` | pauses |
| `cmd:/counterparts [args]` | types the mod's command into the empty prompt, presses Enter, waits until the prompt is empty again, then 1.2 s |
| `keys:<k> [<k>...]` | tmux key names: `Escape`, `Tab`, `Up`, `Down`, `C-x`, `BSpace`, `Enter`..., or one character; never words (that is `type:`) |
| `type:<text>` | printable text, once the pane holds the keyboard (or a slash command's words) |
| `click:<text>` / `click:<col>,<row>` | a left click (SGR mouse press and release) on the first cell of `<text>`, looked for in the pane first; or on a cell, 1-based |
| `hover:<text>` / `hover:<col>,<row>` | the pointer moved there, no click |
| `until:<text>` | waits until `<text>` is on screen (or the timeout) |

Things learned driving it (2026-10-10, Claude Code 2.1.296):

- **The pane gets the keyboard from a click, not from ctrl+x tab.** In tmux,
  ctrl+x tab (`abovePrompt:focus`) left the keys in the prompt, sent as one
  chord or as two keys. `click:search memories` puts the cursor in the field
  and the typing there; `keys:Escape` hands the keyboard back to the prompt.
  The focused pane's divider changes colour.
- **The mouse works.** SGR 1006 reports written into the pane (`send-keys
  -H`) reach the mod: a press on a legend item opens its card, a press on the
  field focuses it, and a move over a switch draws the engine's hover
  inversion and the switch's hover words. A hover lasts until the next move
  (a click elsewhere didn't clear it), so a hovered Button stays inverted in
  later shots: move the pointer off with `hover:1,1`.
- **Enter in the search field is a real `recall`** against the live memory:
  it counts as a deliberate look-up on the dashboard and records which
  memories were shown this session. Type without Enter unless the results
  view is what you came for.

## How it works

- tmux on its own socket (`tmux -L term-loop -f /dev/null`, so no one's
  `~/.tmux.conf`), status line off, one session named
  `term-loop-<pid>-<time>` per run, at `--size`.
- `claude --plugin-dir <dir> --settings '{"tui":"fullscreen"}'`: the
  fullscreen layout, where the sidebar opens by itself. If the sidebar was
  stored hidden, the run opens it with `/counterparts` first (and hides it
  again at the end); that path hasn't run live yet, since the store has held
  `full` throughout.
- **`--permission-mode default`**, so the session asks before any tool: a
  prompt that slipped past the guard would stall at a permission dialog,
  not run tools unattended. So the shots lack the line his own sessions
  draw under the status line, `▸▸ auto mode on (shift+tab to cycle)`. For
  shots with it, `--mode auto` (or `--mode own`: no `--permission-mode` at
  all, his settings decide). `--mode` takes `default`, `manual`, `plan`,
  `acceptEdits`, `auto`, `dontAsk` or `own`; never `bypassPermissions`.
- **Truecolor.** Under `$TMUX`, Claude Code clamps itself to 256 colours,
  whatever `COLORTERM` says (found in its source; `CLAUDE_CODE_TMUX_TRUECOLOR`
  lifts the clamp). The session gets `COLORTERM=truecolor` and
  `CLAUDE_CODE_TMUX_TRUECOLOR=1`, and `capture-pane -e -p -N` keeps the
  `38;2;r;g;b` codes as written: the panel's `#05080c`, the cyan `#00e5ff`,
  the brain's background `#000011` all come through exact. Without the second
  variable the panel came out as 256-colour 16 (`#000000`).
- The cursor comes from `display -p '#{cursor_x} #{cursor_y} #{cursor_flag}'`.
- `grid.ts` reads a capture into cells (SGR truecolor, 256, the sixteen,
  bold/dim/italic/underline/inverse, a wide character as two cells, combining
  marks folded, OSC skipped). `render.ts` draws the grid as absolutely placed
  cells. `steps.ts` reads the steps and holds the keyboard guard. Those three
  are pure, tested in `test/term-loop.test.ts`. `shoot.ts` does tmux and
  Chrome.

## Footprint on the owner's machine

The sessions are real Claude Code sessions with his own login and settings.

- **His npm-installed Counterparts hooks run in them** and read his live
  memory: the wake at start, the session end at exit. Each run is one more
  session to them (all of a run's states are one session, never one a shot).
  The sidebar reads his live dashboard on `localhost:4747`.
- **The environment it runs from goes into the session** (the tmux server
  starts with it). Run from a session that exports
  `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, as this repository's do, his npm
  hooks inside printed no wake (2026-10-10: 0 bytes, against 7.6 KB run
  without it). Run from inside Claude Code, the session also inherits
  `CLAUDECODE` and the parent session's `CLAUDE_CODE_*` variables; what
  Claude Code makes of a child started that way hasn't been looked into.
- **What Claude Code itself writes, as for any session:** the scratch
  folder's entry in `~/.claude.json` (its trust flag, and each session's
  bookkeeping: last session id, cost, durations, model usage), the commands
  typed (`/counterparts quiet`, `/exit`) in `~/.claude/history.jsonl`, and a
  transcript in `~/.claude/projects/<the scratch folder as a slug>/`, which
  keeps what the SessionStart hooks printed: his wake, from his live memory,
  when they print it.
- **No prompt reaches the model.** In his own permission mode (auto,
  2026-10-10) a prompt could also run tools; the run starts in `default`
  (above) unless `--mode` says otherwise. `cmd:` takes only `/counterparts` (or what
  `--allow-cmd` adds: one bare name, never a `plugin:name` skill or
  command), and is refused before anything starts otherwise. `keys:` takes
  tmux key names and single characters only (tmux would type any other
  string, and reads `0xd` or `^M` as Enter). Every Enter, in any spelling,
  is checked against the screen, read twice the same, first: allowed in the
  pane, on an empty prompt, or on an allowed command that the slash
  typeahead has picked as typed; refused on anything else. `type:` is
  printable text only, refused while the prompt holds the keyboard. A click
  outside the pane is refused while the prompt holds anything: the
  typeahead's rows sit there, and what a click on one does wasn't tried.
- **A scratch folder:** `$TMPDIR/counterparts-term-loop/cwd`. The first run
  there answers Claude Code's trust dialog with yes, for that folder only
  (`hasTrustDialogAccepted` on its entry in `~/.claude.json`); so does a
  first run after macOS clears `$TMPDIR`. The tool grants trust to no other
  folder: with `--cwd` anywhere outside `$TMPDIR/counterparts-term-loop`
  (or a folder there with files in it), the dialog stops the run and the
  folder is left untrusted. `--cwd` refuses the home folder, `~/counterparts`,
  this checkout, `~/.counterparts`, `~/.bansai`, `~/.claude-engram`.
- **His sidebar preferences.** A `--plugin-dir` plugin's `$.store` is
  `~/.claude/plugins/store/<name>_inline-<12 hex of sha256("<name>@inline")>.json`
  (`counterparts_inline-41db9a71a546.json`), shared by every folder copy named
  `counterparts`, his own trial copy included. So `/counterparts quiet` or
  `hide` in a run would make his next session open quiet or hidden. The run
  reads that file before it starts (read only), and before the session ends
  puts back whatever differs, through the mod: first the "Claude Code's own
  memory" switch, by a click on it in the full view (that switch is one
  preference for every session, his running ones included, and no command
  turns it), then `view`, `caps`, `fpsShown` and `fps` with the mod's own
  commands. It never writes the file. This runs after a step fails or times
  out as well as after the last step (a prompt a failed step left holding
  words is cleared first), and after a first ^C (or TERM, HUP): the signal
  stops the steps, the preferences go back, the session closes, and no PNGs
  are drawn. A second ^C kills the session as it is. The file is read again
  at the end; if anything still differs, the run says in capitals what to
  type or click, and exits 1. A crash of this process, a `kill -9`, or the
  claude session ending mid-run leaves what it left, said the same way where
  it can be. The preferences are compared, not traced: a change he makes to
  the same keys in his own sessions during a run is put back too.
- **Exit:** `/exit`, then, if the session is still there after 8 s, `tmux
  kill-session` on this run's session only. Never `kill-server`: other work
  runs in tmux. Chrome runs on its own profile under
  `$TMPDIR/counterparts-term-loop/chrome-<pid>`, killed by pid and by that
  profile, and the profile removed.
- **Some clicks in the pane write or open.** The "Counterparts memory ·
  this folder" switch asks Pause or Cancel; `click:Pause` pauses Counterparts
  memory for the scratch folder in his live registry, and the run doesn't
  put that back (`/counterparts resume` does). A `↗` line opens his browser
  on the dashboard. Enter in the search field is a recall (above).
- **The output shows live memory** (activity titles, counts, the folder
  path). `tools/term-loop/out/` is gitignored; don't publish shots without
  looking at them.
- The tool itself never opens `~/.counterparts`, `~/.bansai` or
  `~/.claude-engram`; of his files it reads only the preferences above.

## Fidelity

The theme in `render.ts` is the owner's iTerm2 Default profile, read from its
preferences on 2026-10-10: Menlo Regular 13 at spacing 1 x 1, which iTerm2
lays out in 8 x 16 point cells; foreground `#dcdcdc` on `#000000`; bold in
`#ffffff` with bright bold; faint text at 0.674 alpha; its ANSI 0–15.

Calibrated against his screenshot of the sidebar in iTerm2 (the same state,
the crop lined up on the divider): over the header, the switch labels, the
legend, the search box and the ACTIVITY rule, the mean difference is under
1/255 a channel (0.6–0.7); 1.6 on the divider, 2.8 on the switch (its cyan
track, below); and fewer than 0.1% of pixels are off by more than 48. It
took two corrections: glyphs half a point lower than Chrome's baseline, and
`-webkit-font-smoothing: antialiased`, which matches iTerm2's thin strokes.
Braille comes from the font, as in iTerm2, and its dots land on the same
device pixels (centres 6.5 and 12.5 across a 16-pixel cell, 10, 16, 22.5,
28.5 down a 32-pixel row). Box drawing and block elements are drawn as
shapes, edge to edge, as iTerm2 draws them.

Where it differs from a real terminal, so don't judge these:

- **Saturated backgrounds** draw a few percent off in iTerm2: the switch
  track's `#00e5ff` background shows as about `#01daf2` there, while the same
  cyan as text stays `#00e4ff`. The render paints the value as written. Dark
  backgrounds match within 1.
- **Symbols Menlo lacks** (`◉ ⌕ ⏸ ✕`, emoji) come from Chrome's fallback
  fonts. In the calibration they matched, but judge their place and colour,
  not their exact shape.
- **The cursor** is drawn as a filled white box, iTerm2's focused cursor.
  iTerm2 draws it hollow in a window without focus.
- **One instant.** The brain moves (6–12 frames a second), so two shots never
  show the same frame, and the counts, ACTIVITY and the day are live data.
- No window chrome, margins, tab bar, scrollback, selection, transparency or
  ligatures. Double and dashed box lines come from the font. Wide characters
  follow the mod's own width table; one tmux counted differently would shift
  its row (none seen).
- On a machine without Menlo, or for another iTerm2 profile, the calibration
  no longer holds: the theme is one object in `render.ts`.

## For a visual reviewer

Open the `-sidebar.png` crops at 100%: two image pixels are one point, the
way a Retina screen shows them. The crop starts at the dock's divider; the
owner's own screenshots start 2 pixels further left and 10 higher (his
window's edge), and his window is shorter, so his pane has fewer rows.

Judge: layout and alignment, wrapping and cutting, spacing, the colours of
text and stage dots against the `#05080c` panel, contrast, the brain's shape
and region colours, how each view (full, quiet, hidden, hovered, focused)
reads. Use the full `<name>.png` for what sits outside the pane: the status
line under the prompt (where the hidden view lives), and how wide the dock
is beside the transcript.

Don't judge: the exact brain frame, the live numbers and ACTIVITY rows, the
cursor, fallback-symbol shapes, or a bright background a few percent off.
